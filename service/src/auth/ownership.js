'use strict';

function mayReadOrder(principal, order) {
  // Outlet membership is not modeled in the P3 schema yet, so staff access is
  // deliberately not widened until an outlet-to-principal relation exists.
  return principal?.domainId === order.customer_id;
}

function mayCancelOrder(principal, order) {
  return principal?.domainId === order.customer_id;
}

function mayCreateOrder(principal, customerId) {
  return principal?.domainId === customerId;
}

module.exports = { mayReadOrder, mayCancelOrder, mayCreateOrder };
