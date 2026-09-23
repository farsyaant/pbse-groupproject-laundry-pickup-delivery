'use strict';

// Layer 3 — object authorization. One predicate per resource relationship, in
// one file, so the rules can be read and tested without reading the handlers.
//
// Every predicate answers "may this principal access this object?". A `false`
// result must be rendered as the same 404 used for an absent object; never as
// 403, and never with a distinguishing message.
//
// The outlet relation comes from the provider-issued identity binding
// (`principal.outletId`), not from the token's scopes. Scopes gate which
// *operations* a caller may invoke; ownership decides which *objects* are
// visible. Keeping the two apart is the point of the three-layer split: a
// caller cannot widen its object visibility by requesting more scopes.

function isStaffOfOutlet(principal, outletId) {
  return Boolean(principal?.outletId && outletId && principal.outletId === outletId);
}

/**
 * Staff intake rule. Staff may claim an order that is not yet bound to any
 * outlet (accepting an incoming order for their own outlet) and may keep
 * working on orders already bound to their outlet. Orders bound to another
 * outlet are out of reach.
 */
function mayClaimOrder(principal, order) {
  if (!principal?.outletId) return false;
  if (!principal.scopes.includes('orders:fulfil')) return false;
  return order.outlet_id === null || order.outlet_id === principal.outletId;
}

/**
 * @param {object} principal
 * @param {object} order
 * @param {{driverId?: string}|null} [assignment] pickup assigned to this order,
 *   when one exists. Resolved by the caller because only the caller knows
 *   whether the lookup is needed.
 */
function mayReadOrder(principal, order, assignment = null) {
  if (!principal) return false;
  if (principal.domainId === order.customer_id) return true;
  if (isStaffOfOutlet(principal, order.outlet_id)) return true;
  if (
    assignment?.driverId &&
    principal.scopes.includes('pickups:write') &&
    assignment.driverId === principal.domainId
  ) {
    return true;
  }
  return false;
}

function mayCancelOrder(principal, order) {
  return Boolean(principal) && principal.domainId === order.customer_id;
}

function mayCreateOrder(principal, customerId) {
  return Boolean(principal) && principal.domainId === customerId;
}

function mayCollectPickup(principal, pickup) {
  return Boolean(principal) && pickup.driver_id === principal.domainId;
}

module.exports = {
  isStaffOfOutlet,
  mayClaimOrder,
  mayReadOrder,
  mayCancelOrder,
  mayCreateOrder,
  mayCollectPickup,
};
