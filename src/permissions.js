// Centralized authorization policy. Default deny; country and customer grants are separate.
export const ROLE_PERMISSIONS=Object.freeze({
 super_admin:['users.read','users.create','users.manage','roles.read','roles.assign','roles.revoke','country_leads.manage','customer_access.read','customer_access.manage','audit.read','registrations.review','customers.read','customers.create'],
 admin:['users.read','users.create','roles.read','customer_access.read','customer_access.manage','registrations.review','customers.read'],
 country_lead:['users.read','users.manage','roles.read','customer_access.read','customer_access.manage','registrations.review','customers.read','customers.create'],
 regional_manager:['customers.read'],
 group_leader:['customers.read'],
 technician:['customers.read'],
 requester:['customer_portal.read']
});
export const ASSIGNABLE_ROLES=Object.freeze(['admin','country_lead','regional_manager','group_leader','technician','requester']);
export function hasPermission(roles,permission){
 if(!Array.isArray(roles)||roles.length===0)return false;
 if(roles.includes('requester')&&roles.some(r=>r!=='requester'))return false;
 return roles.some(role=>ROLE_PERMISSIONS[role]?.includes(permission));
}
export function canManageRole(actorRoles,targetRoles,role,action){
 if(!['assign','revoke'].includes(action)||!ASSIGNABLE_ROLES.includes(role))return false;
 if(!hasPermission(actorRoles,'roles.assign')||!hasPermission(actorRoles,'roles.revoke'))return false;
 if(targetRoles.includes('super_admin')||role==='super_admin')return false;
 if(role==='requester'&&targetRoles.some(r=>r!=='requester'))return false;
 if(role!=='requester'&&targetRoles.includes('requester'))return false;
 return true;
}
export function countryAuthorized(actorRoles,assignedCountries,country){
 return hasPermission(actorRoles,'customer_access.read')&&(actorRoles.includes('super_admin')||actorRoles.includes('admin')||actorRoles.includes('country_lead')&&assignedCountries.includes(country));
}
export function customerAuthorized(actorRoles,assignedCustomerIds,customerId){
 return hasPermission(actorRoles,'customer_portal.read')&&assignedCustomerIds.includes(customerId);
}
