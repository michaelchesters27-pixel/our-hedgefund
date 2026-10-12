# OUR HEDGEFUND

A live MT5 balance dashboard for Micky and Doc, with **50% ownership each**.

- Only Micky and Doc may log in; other accounts and their sessions are rejected.
- Withdrawal buttons and the withdrawal API are removed.
- Every member is displayed as 50% of the live fund equity; MT5 reporting updates both capital balances equally.
- The migration removes the third member and reconciles the database ledger to 50/50. It does not transfer broker funds.
- A shared hardcoded PIN remains; rotate it and implement separate account credentials before relying on this for real-money privacy.
- There are no trading controls in the dashboard.

Netlify Functions serve the API and Netlify Database stores account figures.
The MT5 reporter is not committed because it contains a private reporter key.
