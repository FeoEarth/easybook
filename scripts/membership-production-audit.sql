-- Aggregate only: never print account identifiers, codes, or transaction hashes.
SELECT
 (SELECT COUNT(*) FROM (
   SELECT chain_id, LOWER(tx), log_index
   FROM membership_receipts
   GROUP BY chain_id, LOWER(tx), log_index
   HAVING COUNT(*) > 1
 )) AS duplicate_receipt_groups,
 (SELECT COUNT(*) FROM membership_gift_orders o
   JOIN membership_gift_cards c ON c.purchaser_id=o.account_id AND c.request_id=o.idempotency
   WHERE c.id<>o.id AND o.settled_at IS NULL AND o.cancelled_at IS NULL
 ) AS pending_gift_key_collisions;
