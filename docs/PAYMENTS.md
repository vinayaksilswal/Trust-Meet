# Payments

Trust Meet sells two things through Razorpay. Billing is off until `ENABLE_BILLING=true`.

- **Premium day passes** (1, 3 or 7 days) unlock the gender filter, the region filter and priority matching. Prices come from `PASS_PRICE_1D_INR`, `PASS_PRICE_3D_INR` and `PASS_PRICE_7D_INR`.
- **Plus** is an optional monthly subscription that removes ads and includes premium. It is offered only when `RAZORPAY_PLUS_PLAN_ID` is set.

## Day passes

1. `POST /billing/pass` creates a Razorpay order for the chosen pass and stores it in `pass_orders`.
2. The browser opens Razorpay Checkout with that order.
3. `POST /billing/pass/verify` checks the signature (HMAC-SHA256 of `order_id|payment_id`), confirms with the Razorpay API that the order is `paid` for the full amount, and extends `premium_access.ends_at`. A pass bought while another is active adds to the remaining time.
4. The `order.paid` webhook does the same, so a pass still activates if the buyer closes the tab before step 3. Each order grants access once.

The gender filter uses the gender people declare themselves. Region comes from the visitor's country at the hosting edge (`x-vercel-ip-country`). Neither is verified, so describe them as preferences, not guarantees.

## Plus subscription

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
3. Add a webhook to `https://<domain>/api/billing/webhook` with a strong secret. Select `order.paid` and the `subscription.*` events.
4. Run `alembic upgrade head` to apply migrations 0007 and 0008.
5. Buy Plus with a test card or UPI test ID and confirm that `/me` reports `plus: true` and the ads disappear.

Refunds are issued from the Razorpay dashboard. There is no in-app refund flow or invoice ledger yet. GST invoicing depends on your registration and needs an accountant's review.
