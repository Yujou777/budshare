#!/usr/bin/env bash
# Fill the remaining placeholders in the Bud Share legal files.
# Required env: LEGAL_EMAIL LEGAL_PHONE IO_NAME IO_EMAIL EFFECTIVE_DATE
# Optional env (other draft placeholders, filled only if set):
#   IO_REG_REF      -> [INFORMATION OFFICER REGISTRATION REFERENCE, once registered]
#   RETENTION_PERIOD-> [RETENTION PERIOD, e.g. 3 years]
#   LOG_RETENTION   -> [LOG RETENTION, e.g. 30–90 days]
#   SELF_REG_BODY   -> [SELF-REGULATORY BODY, or "None"]
#   GITHUB_NOTE     -> [CONFIRM: no member data stored]
#   PUBLISH=1       -> also removes the "DRAFT – for review" line and "(draft)" version tag
# Usage: LEGAL_EMAIL=.. LEGAL_PHONE=.. IO_NAME=.. IO_EMAIL=.. EFFECTIVE_DATE="1 November 2026" ./fill-legal.sh
set -euo pipefail
cd "$(dirname "$0")"
FILES=(legal/terms.md legal/privacy.md public/legal-terms.html public/legal-privacy.html)
missing=0
for v in LEGAL_EMAIL LEGAL_PHONE IO_NAME IO_EMAIL EFFECTIVE_DATE; do
  [ -n "${!v:-}" ] || { echo "Missing env var: $v" >&2; missing=1; }
done
[ "$missing" = 0 ] || exit 1

# escape for sed replacement (\ & and the | delimiter)
esc(){ printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
rep(){ # placeholder-literal  value
  local pat; pat=$(printf '%s' "$1" | sed -e 's/[]\[\\.*^$|/]/\\&/g')
  sed -i -e "s|$pat|$(esc "$2")|g" "${FILES[@]}"
}
rep '[CONTACT EMAIL]'              "$LEGAL_EMAIL"
rep '[CONTACT TELEPHONE NUMBER]'   "$LEGAL_PHONE"
rep '[INFORMATION OFFICER NAME]'   "$IO_NAME"
rep '[INFORMATION OFFICER EMAIL]'  "$IO_EMAIL"
rep '[EFFECTIVE DATE]'             "$EFFECTIVE_DATE"
[ -n "${IO_REG_REF:-}" ]       && rep '[INFORMATION OFFICER REGISTRATION REFERENCE, once registered]' "$IO_REG_REF"
[ -n "${RETENTION_PERIOD:-}" ] && rep '[RETENTION PERIOD, e.g. 3 years]' "$RETENTION_PERIOD"
[ -n "${LOG_RETENTION:-}" ]    && rep '[LOG RETENTION, e.g. 30–90 days]' "$LOG_RETENTION"
[ -n "${SELF_REG_BODY:-}" ]    && rep '[SELF-REGULATORY BODY, or "None"]' "$SELF_REG_BODY"
[ -n "${GITHUB_NOTE:-}" ]      && rep '[CONFIRM: no member data stored]' "$GITHUB_NOTE"
if [ "${PUBLISH:-}" = 1 ]; then
  sed -i -e '/DRAFT – for review before publication/d' -e 's/ (draft)//' "${FILES[@]}"
fi

# Confirm: any bracketed placeholders left? (markdown links like [text](url) are ignored)
left=$(grep -noE '\[[A-Z][A-Z0-9 ,/().:"–-]{2,}[^]]*\]' "${FILES[@]}" || true)
if [ -n "$left" ]; then
  echo "Placeholders still remaining ($(printf '%s\n' "$left" | wc -l)):"; printf '%s\n' "$left"; exit 2
fi
echo "All placeholders filled in: ${FILES[*]}"
echo "Note: legal/BudShare-Terms-and-Privacy-DRAFT.pdf is a static draft and is NOT updated by this script."
