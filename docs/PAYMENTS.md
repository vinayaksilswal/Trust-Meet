# Payments

Trust Meet Plus is a monthly Razorpay subscription. It removes advertising. Billing is off until `ENABLE_BILLING=true`.

## How it works

1. `POST /billing/subscribe` creates a Razorpay subscription for `RAZORPAY_PLUS_PLAN_ID`, or reuses an unpaid one, and stores it in `subscriptions`.
2. The browser opens Razorpay Checkout with that subscription ID.
3. `POST /billing/verify` checks the checkout signature (HMAC-SHA256 of `payment_id|subscription_id` with the key secret), then reads the subscription back from the Razorpay API.
4. `POST /billing/webhook` verifies `X-Razorpay-Signature` over the raw body with `RAZORPAY_WEBHOOK_SECRET`, skips repeated `X-Razorpay-Event-Id` values, and re-reads the subscription from Razorpay. Event order therefore does not matter. A failed read returns 503 so Razorpay retries.
5. Plus is active while the subscription is `active` or `pending` and `current_end` is in the future. `POST /billing/cancel` cancels at the end of a paid period.

Test keys (`rzp_test_`) work in any environment. Live keys (`rzp_live_`) require `ENVIRONMENT=production`.

## Razorpay setup

1. Complete business KYC. Razorpay checks that the site shows Terms, Privacy, Refund and Cancellation, and Contact pages. They are at `/terms`, `/privacy`, `/refunds` and `/contact`. Fill in the `NEXT_PUBLIC_OPERATOR_*`, support and grievance variables first.
2. Enable Subscriptions and create a monthly plan at the price in `PLUS_PRICE_INR`. Copy its `plan_` ID.
3. Add a webhook to `https://<domain>/api/billing/webhook` with a strong secret. Select the `subscription.*` events.
4. Run `alembic upgrade head` to create the `subscriptions` and `billing_events` tables (migration 0007).
5. Buy Plus with a test card or UPI test ID and confirm that `/me` reports `plus: true` and the ads disappear.

Refunds are issued from the Razorpay dashboard. There is no in-app refund flow or invoice ledger yet. GST invoicing depends on your registration and needs an accountant's review.
