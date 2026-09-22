#!/usr/bin/env bash
# End-to-end smoke for the digital-sales phases (run against localhost:3000).
set -u
BASE=http://localhost:3000
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL $1 — $2"; }

J=$(mktemp)
# shellcheck disable=SC1091
source .env.local

# ── helpers ──────────────────────────────────────────────────────────
jnode() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(eval(process.argv[1]))}catch(e){console.log('ERR:'+e.message)}})" "$1"; }

# 1) admin login
LOGIN=$(curl -s -c "$J" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$LOGIN" | grep -qi 'ok\|admin' && ok login || bad login "$LOGIN"

# 2) site content + pick patterns
CONTENT=$(curl -s -b "$J" "$BASE/api/admin/content")
PAT_ID=$(echo "$CONTENT" | jnode "JSON.parse(s).patterns[0].id")
EXCL_ID=$(echo "$CONTENT" | jnode "const j=JSON.parse(s); const p=j.patterns.find(x=>x.id!=='$PAT_ID'); p?p.id:''")
PAT_PRICE=$(echo "$CONTENT" | jnode "JSON.parse(s).patterns.find(p=>p.id==='$PAT_ID').price.fa")
EXCL_PRICE=$(echo "$CONTENT" | jnode "JSON.parse(s).patterns.find(p=>p.id==='$EXCL_ID').price.fa")
[ -n "$PAT_ID" ] && [ -n "$EXCL_ID" ] && ok "content ($PAT_ID / $EXCL_ID)" || bad content "pat=$PAT_ID excl=$EXCL_ID"

# 3) upload master (valid 64×64 PNG)
node -e "
const z=require('zlib');const fs=require('fs');
const crc=(b)=>{let c=~0;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return (~c)>>>0};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(64,0);ihdr.writeUInt32BE(64,4);ihdr[8]=8;ihdr[9]=2;
const raw=Buffer.alloc(64*(1+64*3));
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',z.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync('/tmp/e2e.png',png);
"
UP=$(curl -s -b "$J" -X POST "$BASE/api/master/upload" \
  -F "file=@/tmp/e2e.png;filename=e2e.png" -F "title=E2E Master" -F "description=e2e")
MID=$(echo "$UP" | jnode "const j=JSON.parse(s); (j.master&&j.master.id)||j.id||''")
[ -n "$MID" ] && ok "upload ($MID)" || bad upload "$UP"

# 4) approve + link pattern
if [ -n "$MID" ]; then
  AP=$(curl -s -b "$J" -X PATCH "$BASE/api/admin/masters" -H 'content-type: application/json' \
    -d "{\"id\":\"$MID\",\"action\":\"approve\",\"patternId\":\"$PAT_ID\"}")
  echo "$AP" | grep -q '"ok":true' && ok approve || bad approve "$AP"
fi

# 5) auto mockups
if [ -n "$MID" ]; then
  MK=$(curl -s -b "$J" -X POST "$BASE/api/admin/masters" -H 'content-type: application/json' -d "{\"id\":\"$MID\"}")
  echo "$MK" | grep -q '"ok":true' && ok "mockups ($(echo "$MK" | jnode "JSON.parse(s).mockups.length"))" || bad mockups "$MK"
fi

# 6) discount code via /api/discounts
DC=$(curl -s -b "$J" -X POST "$BASE/api/discounts" -H 'content-type: application/json' \
  -d '{"action":"create","code":"E2E10","kind":"percent","value":10,"maxUses":100}')
echo "$DC" | grep -Eq '"ok":true|already' && ok discount || bad discount "$DC"

# 7) checkout commercial + discount (server: unit=round(base*mult/1e4)*1e4, then −pct)
PRICE_TOTAL=$(node -e "const u=Math.round($PAT_PRICE*2.4/10000)*10000; console.log(u-Math.round(u*10/100))")
CO=$(curl -s -b "$J" -X POST "$BASE/api/payments/checkout" -H 'content-type: application/json' \
  -d "{\"lines\":[{\"kind\":\"pattern\",\"id\":\"$PAT_ID\",\"license\":\"commercial\",\"qty\":1}],\"discountCode\":\"E2E10\",\"name\":\"admin\",\"email\":\"\"}")
AUTH=$(echo "$CO" | jnode "const j=JSON.parse(s); j.authority||((j.redirectUrl||'').match(/\\/pay\\/([^?&/]+)/)||[])[1]||''")
PUR=$(echo "$CO" | jnode "const j=JSON.parse(s); j.purchaseId||(j.purchase&&j.purchase.id)||''")
TOTAL=$(echo "$CO" | jnode "const j=JSON.parse(s); const m=(j.redirectUrl||'').match(/[?&]amount=(\\d+)/); m?m[1]:((j.purchase&&j.purchase.total&&j.purchase.total.fa)||'')")
[ -n "$AUTH" ] && ok "checkout ($AUTH / $PUR total=$TOTAL expected=$PRICE_TOTAL)" || bad checkout "$CO"
[ -n "$AUTH" ] && [ "$TOTAL" = "$PRICE_TOTAL" ] && ok "discount total" || bad "discount total" "got=$TOTAL want=$PRICE_TOTAL"

# 8) cashier page + sig extract (RSC-escaped)
SIG=""
if [ -n "$AUTH" ]; then
  CH=$(curl -s -b "$J" -o /tmp/cashier.html -w '%{http_code}' "$BASE/fa/pay/$AUTH")
  [ "$CH" = "200" ] && ok cashier || bad cashier "http $CH"
  SIG=$(node scripts/extract-sig.mjs /tmp/cashier.html sigOk)
  [ -n "$SIG" ] && ok "sig (${SIG:0:12}…)" || bad sig "not found"
fi

# 9) bad sig must redirect to payment_failed
if [ -n "$AUTH" ]; then
  BADR=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/api/payments/zarinpal/callback?Authority=$AUTH&Status=OK&sig=TAMPERED")
  if echo "$BADR" | grep -q 'error=payment_failed'; then ok "bad-sig rejected"; else bad "bad-sig" "redirect=$BADR"; fi
fi

# 10) good callback fulfils
if [ -n "$AUTH" ] && [ -n "$SIG" ]; then
  REDIR=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/api/payments/zarinpal/callback?Authority=$AUTH&Status=OK&sig=$SIG")
  if echo "$REDIR" | grep -q "paid=1"; then ok "callback paid"; else bad callback "redirect=$REDIR"; fi
fi

# 11) purchase paid + signed download + certificate + verify
PURS=$(curl -s -b "$J" "$BASE/api/purchases")
if [ -n "$PUR" ]; then
  ST=$(echo "$PURS" | jnode "const j=JSON.parse(s); const arr=j.purchases||j; const p=(Array.isArray(arr)?arr:[]).find(x=>x.id==='$PUR'); p?p.status:''")
  [ "$ST" = "paid" ] && ok "purchase paid" || bad "purchase paid" "status=$ST"
fi
DLU=$(echo "$PURS" | jnode "const m=s.match(/\"downloadUrl\":\"([^\"]+)\"/); m?m[1]:''")
CLU=$(echo "$PURS" | jnode "const m=s.match(/\"certificateUrl\":\"([^\"]+)\"/); m?m[1]:''")
[ -n "$DLU" ] && ok "downloadUrl present" || bad downloadUrl "missing"
if [ -n "$DLU" ]; then
  DLU_PATH=$(echo "$DLU" | sed "s|$BASE||")
  DCODE=$(curl -s -o /tmp/dl.bin -w '%{http_code}' "$BASE$DLU_PATH")
  SZ=$(wc -c </tmp/dl.bin)
  [ "$DCODE" = "200" ] && ok "download 200 ($SZ B)" || bad download "http $DCODE"
  BADT=$(echo "$DLU_PATH" | sed 's/t=/t=AAAA/')
  TCODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$BADT")
  [ "$TCODE" = "403" ] && ok "tampered 403" || bad "tampered" "http $TCODE"
fi
if [ -n "$CLU" ]; then
  CLU_PATH=$(echo "$CLU" | sed "s|$BASE||")
  # PDF issue requires the holder session (or admin) — send cookies.
  CCODE=$(curl -s -b "$J" -o /tmp/cert.pdf -w '%{http_code}' "$BASE$CLU_PATH")
  CSZ=$(wc -c </tmp/cert.pdf)
  [ "$CCODE" = "200" ] && ok "certificate PDF ($CSZ B)" || bad certificate "http $CCODE"
fi
CERT_NO=$(grep -oa 'RA-[A-Z0-9-]*' /tmp/cert.pdf 2>/dev/null | head -1 || true)
if [ -z "$CERT_NO" ]; then
  CERT_NO=$(echo "$PURS" | jnode "const m=s.match(/RA-[A-Z0-9-]+/); m?m[0]:''")
fi
if [ -n "$CERT_NO" ]; then
  VJ=$(curl -s "$BASE/api/license?verify=$CERT_NO")
  echo "$VJ" | grep -Eq '"valid":true|ok.:true' && ok "verify $CERT_NO" || bad verify "$VJ"
  VBAD=$(curl -s "$BASE/api/license?verify=RA-XXXX-XXXX-XXXX")
  echo "$VBAD" | grep -Eq '"valid":false|"ok":false|error' && ok "bogus rejected" || bad "bogus verify" "$VBAD"
else
  bad verify "no certificateNo"
fi

# 12) royalty ledger
FIN=$(curl -s -b "$J" "$BASE/api/admin/finance")
ROY=$(echo "$FIN" | jnode "JSON.parse(s).royalties.length")
[ "${ROY:-0}" -gt 0 ] && ok "royalties=$ROY" || bad royalties "0"

# 13) exclusive checkout → pay → pattern ABSENT from content
EX_TOTAL=$(node -e "console.log(Math.round($EXCL_PRICE*8/10000)*10000)")
# exclusive unit has no discount — same rounding as patternUnitPrice
CO2=$(curl -s -b "$J" -X POST "$BASE/api/payments/checkout" -H 'content-type: application/json' \
  -d "{\"lines\":[{\"kind\":\"pattern\",\"id\":\"$EXCL_ID\",\"license\":\"exclusive\",\"qty\":1}],\"discountCode\":\"\",\"name\":\"admin\",\"email\":\"\"}")
AUTH2=$(echo "$CO2" | jnode "const j=JSON.parse(s); j.authority||((j.redirectUrl||'').match(/\\/pay\\/([^?&/]+)/)||[])[1]||''")
PUR2=$(echo "$CO2" | jnode "const j=JSON.parse(s); j.purchaseId||''")
if [ -n "$AUTH2" ]; then
  ok "excl checkout ($EXCL_ID / $PUR2 total want $EX_TOTAL)"
  curl -s -b "$J" -o /tmp/cashier2.html "$BASE/fa/pay/$AUTH2"
  SIG2=$(node scripts/extract-sig.mjs /tmp/cashier2.html sigOk)
  if [ -n "$SIG2" ]; then
    REDIR2=$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/api/payments/zarinpal/callback?Authority=$AUTH2&Status=OK&sig=$SIG2")
    if echo "$REDIR2" | grep -q 'paid=1'; then ok "excl paid"; else bad "excl paid" "redirect=$REDIR2"; fi
    CONTENT2=$(curl -s -b "$J" "$BASE/api/admin/content")
    STILL=$(echo "$CONTENT2" | jnode "const j=JSON.parse(s); (j.patterns||[]).some(p=>p.id==='$EXCL_ID')?'yes':'no'")
    [ "$STILL" = "no" ] && ok "exclusive delisted ($EXCL_ID absent)" || bad "exclusive delist" "still present"
    # second exclusive checkout must 409 sold_exclusive
    CO3=$(curl -s -b "$J" -X POST "$BASE/api/payments/checkout" -H 'content-type: application/json' \
      -d "{\"lines\":[{\"kind\":\"pattern\",\"id\":\"$EXCL_ID\",\"license\":\"exclusive\",\"qty\":1}],\"name\":\"admin\",\"email\":\"\"}")
    echo "$CO3" | grep -q 'sold_exclusive\|pattern_not_found' && ok "re-buy rejected" || bad "re-buy" "$CO3"
  else
    bad "excl sig" "not found"
  fi
else
  bad "excl checkout" "$CO2"
fi

# 14) outbox delivery mail persisted (session recipient)
OUT=$(ls data/outbox 2>/dev/null | wc -l | tr -d ' ')
[ "${OUT:-0}" -gt 0 ] && ok "outbox mails=$OUT" || bad outbox "empty"

# 15) earnings API
EARN=$(curl -s -b "$J" -o /tmp/earn.json -w '%{http_code}' "$BASE/api/artist/earnings")
[ "$EARN" = "200" ] && ok "earnings 200" || bad earnings "http $EARN"

echo "---- PASS=$PASS FAIL=$FAIL ----"
rm -f "$J"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
