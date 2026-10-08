# OUR HEDGEFUND

GitHub + Netlify only. No Railway.

## Demo rules
- Micky: 40%
- Doc: 30%
- Hacky: 30%
- Shared demo PIN: 54321
- No trade history
- No trading controls
- Dashboard follows MT5 demo balance/equity
- Each logged-in member can only use their own Withdraw button

## Netlify
Netlify Functions provide the API.
Netlify Database stores the balance allocation, sessions and demo withdrawals.

Import this repository into Netlify. The committed migration is applied by Netlify on deploy.

## MT5
The MT5 reporter is deliberately NOT committed because it contains the private reporter key.
Use the separately supplied `OUR_HEDGEFUND_Netlify_BalanceReporter.mq5`.

Before attaching it, add your final Netlify site URL to:
MT5 > Tools > Options > Expert Advisors > Allow WebRequest for listed URL.
