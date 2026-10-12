# OUR HEDGEFUND

GitHub + Netlify live-account dashboard.

## Access
- Dashboard members: Micky and Doc only.
- Former third-party login is rejected server-side, including old sessions.
- **Security:** The legacy shared PIN is still hardcoded. Rotate it and use distinct credentials before relying on this for live funds.
- No withdrawals via interface or API.
- No trading controls or trade history.
- Account balance and equity are reported by the MT5 reporter.

## Ownership and historical capital
The original accounting stored Micky 40%, Doc 30%, third party 30%. The third party is no longer shown as an active member, but historical third-party capital remains in the accounting ledger; no money or ownership has been reassigned. The dashboard discloses this reserved capital. Confirm the new Micky/Doc split and settle the third-party allocation before changing the ledger. Do not misrepresent the displayed member values as a fully reconciled two-person split.

## Netlify
Netlify Functions provide the API. Netlify Database holds capital allocations and sessions.

## MT5
The MT5 reporter is not committed because it contains the private reporter key.
Use `OUR_HEDGEFUND_Netlify_BalanceReporter.mq5`.
