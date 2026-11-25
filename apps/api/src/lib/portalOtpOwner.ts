import { sql } from 'drizzle-orm';
import { db } from '../db';
import { nasAddressClaims } from './nasHistory';

// Return no owner rather than choosing between tenants at the same priority.
// Accounting tenancy follows the emitting NAS, never the package/payment owner.
// Priority: current PPP, latest actual hotspot use, recoverable PPP service,
// then completed hotspot login only when actual accounting is absent.
export async function resolvePortalOtpOwner(email: string): Promise<string | null> {
    const rows = await db.execute<{ owner_id: string | null }>(sql`
        with claims as materialized (${nasAddressClaims}),
        customer as (
            select id, username from "user" where email = ${email}
        ),
        services as (
            select service.*, device.owner_id as nas_owner_id
            from pppoe_service_account service
            join customer on customer.id = service.customer_user_id
                and customer.username = service.normalized_phone
            left join nas_device device on device.id = service.nas_device_id
        ),
        sessions as materialized (
            select accounting.acctstoptime,
                greatest(accounting.acctstarttime, accounting.acctupdatetime,
                    accounting.acctstoptime) as used_at,
                (service.id is not null or activation.pppoe_service_account_id is not null) as ppp,
                case when count(distinct claim.owner_id) = 1 then min(claim.owner_id) end as owner_id,
                service.tenant_admin_id,
                service.status as service_status,
                ((activation.user_id is null or activation.user_id in (select id from customer))
                    and (service.id is null or service.customer_user_id in (select id from customer))) as identity_trusted,
                (service.id in (select id from services where nas_device_id is null
                    or nas_owner_id = tenant_admin_id)
                    and (activation.pppoe_service_account_id is null
                        or activation.pppoe_service_account_id = service.id)) as service_trusted
            from radacct accounting
            left join activated_packages activation on activation.id::text = accounting.class
            left join pppoe_service_account service on service.username = accounting.username
            left join claims claim on claim.ip = host(accounting.nasipaddress)
            where accounting.acctstarttime is not null
                and (activation.user_id in (select id from customer)
                    or service.customer_user_id in (select id from customer))
            group by accounting.radacctid, service.id,
                activation.pppoe_service_account_id, activation.user_id
        ),
        candidates as (
            select 1 as priority, null::timestamptz as used_at,
                case when identity_trusted and service_trusted and service_status <> 'closed'
                    and tenant_admin_id = owner_id then owner_id end as owner_id
            from sessions where ppp and acctstoptime is null
            union all
            select 2, used_at, case when identity_trusted then owner_id end
            from sessions where not ppp
            union all
            -- Active and suspended services both remain recoverable. Closed
            -- services do not. A legacy unbound service retains its tenant;
            -- a bound service must still agree with its NAS's owner.
            select 3, null::timestamptz,
                case when nas_device_id is null or nas_owner_id = tenant_admin_id
                    then tenant_admin_id end
            from services where status <> 'closed'
            union all
            select 4, request.updated_at, device.owner_id
            from hotspot_login_request request
            join customer on customer.id = request.user_id
            left join nas_device device on device.id = request.nas_device_id
            where request.status = 'completed' and request.hotspot_username is not null
                and not exists (select 1 from sessions)
        ),
        preferred as (
            select owner_id, dense_rank() over (order by priority, used_at desc nulls last) as rank
            from candidates
        )
        select id as owner_id from admin_user
        where id = (
            select case when count(*) = count(owner_id) and count(distinct owner_id) = 1
                then min(owner_id) end
            from preferred where rank = 1
        ) and (not coalesce(banned, false) or ban_expires <= now())
    `);
    return rows[0]?.owner_id ?? null;
}
