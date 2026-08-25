import { sql } from 'drizzle-orm';
import {
    bigint,
    bigserial,
    index,
    inet,
    integer,
    pgTable,
    serial,
    text,
    timestamp,
    unique,
    varchar,
} from 'drizzle-orm/pg-core';
export const radacct = pgTable(
    'radacct',
    {
        radacctid: bigserial({ mode: 'bigint' }).primaryKey().notNull(),
        acctsessionid: text().notNull(),
        acctuniqueid: text().notNull(),
        username: text(),
        realm: text(),
        nasipaddress: inet().notNull(),
        nasportid: text(),
        nasporttype: text(),
        acctstarttime: timestamp({ withTimezone: true, mode: 'date' }),
        acctupdatetime: timestamp({ withTimezone: true, mode: 'date' }),
        acctstoptime: timestamp({ withTimezone: true, mode: 'date' }),
        // You can use { mode: "bigint" } if numbers are exceeding js number limitations
        acctinterval: bigint({ mode: 'number' }),
        // You can use { mode: "bigint" } if numbers are exceeding js number limitations
        acctsessiontime: bigint({ mode: 'number' }),
        acctauthentic: text(),
        connectinfoStart: text('connectinfo_start'),
        connectinfoStop: text('connectinfo_stop'),
        // You can use { mode: "bigint" } if numbers are exceeding js number limitations
        acctinputoctets: bigint({ mode: 'number' }),
        // You can use { mode: "bigint" } if numbers are exceeding js number limitations
        acctoutputoctets: bigint({ mode: 'number' }),
        calledstationid: text(),
        callingstationid: text(),
        acctterminatecause: text(),
        servicetype: text(),
        framedprotocol: text(),
        framedipaddress: inet(),
        framedipv6address: inet(),
        framedipv6prefix: inet(),
        framedinterfaceid: text(),
        delegatedipv6prefix: inet(),
        class: text(),
    },
    (table) => [
        index('radacct_active_session_idx')
            .using('btree', table.acctuniqueid.asc().nullsLast().op('text_ops'))
            .where(sql`(acctstoptime IS NULL)`),
        index('radacct_bulk_close')
            .using(
                'btree',
                table.nasipaddress.asc().nullsLast().op('inet_ops'),
                table.acctstarttime.asc().nullsLast().op('timestamptz_ops'),
            )
            .where(sql`(acctstoptime IS NULL)`),
        index('radacct_calss_idx').using(
            'btree',
            table.class.asc().nullsLast().op('text_ops'),
        ),
        index('radacct_start_user_idx').using(
            'btree',
            table.acctstarttime.asc().nullsLast().op('timestamptz_ops'),
            table.username.asc().nullsLast().op('text_ops'),
        ),
        unique('radacct_acctuniqueid_key').on(table.acctuniqueid),
    ],
);

export const radcheck = pgTable(
    'radcheck',
    {
        id: serial().primaryKey().notNull(),
        username: text().default('').notNull(),
        attribute: text().default('').notNull(),
        op: varchar({ length: 2 }).default('==').notNull(),
        value: text().default('').notNull(),
    },
    (table) => [
        index('radcheck_username').using(
            'btree',
            table.username.asc().nullsLast().op('text_ops'),
            table.attribute.asc().nullsLast().op('text_ops'),
        ),
    ],
);

export const radgroupcheck = pgTable(
    'radgroupcheck',
    {
        id: serial().primaryKey().notNull(),
        groupname: text().default('').notNull(),
        attribute: text().default('').notNull(),
        op: varchar({ length: 2 }).default('==').notNull(),
        value: text().default('').notNull(),
    },
    (table) => [
        index('radgroupcheck_groupname').using(
            'btree',
            table.groupname.asc().nullsLast().op('text_ops'),
            table.attribute.asc().nullsLast().op('text_ops'),
        ),
    ],
);

export const radgroupreply = pgTable(
    'radgroupreply',
    {
        id: serial().primaryKey().notNull(),
        groupname: text().default('').notNull(),
        attribute: text().default('').notNull(),
        op: varchar({ length: 2 }).default('=').notNull(),
        value: text().default('').notNull(),
    },
    (table) => [
        index('radgroupreply_groupname').using(
            'btree',
            table.groupname.asc().nullsLast().op('text_ops'),
            table.attribute.asc().nullsLast().op('text_ops'),
        ),
    ],
);

export const radreply = pgTable(
    'radreply',
    {
        id: serial().primaryKey().notNull(),
        username: text().default('').notNull(),
        attribute: text().default('').notNull(),
        op: varchar({ length: 2 }).default('=').notNull(),
        value: text().default('').notNull(),
    },
    (table) => [
        index('radreply_username').using(
            'btree',
            table.username.asc().nullsLast().op('text_ops'),
            table.attribute.asc().nullsLast().op('text_ops'),
        ),
    ],
);

export const radusergroup = pgTable(
    'radusergroup',
    {
        id: serial().primaryKey().notNull(),
        username: text().default('').notNull(),
        groupname: text().default('').notNull(),
        priority: integer().default(0).notNull(),
    },
    (table) => [
        index('radusergroup_username').using(
            'btree',
            table.username.asc().nullsLast().op('text_ops'),
        ),
    ],
);

export const radpostauth = pgTable(
    'radpostauth',
    {
        id: bigserial({ mode: 'bigint' }).primaryKey().notNull(),
        username: text().notNull(),
        pass: text(),
        reply: text(),
        calledstationid: text(),
        callingstationid: text(),
        authdate: timestamp({ withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
        class: text(),
    },
    (table) => [
        index('radpostauth_class_idx').using(
            'btree',
            table.class.asc().nullsLast().op('text_ops'),
        ),
        index('radpostauth_username_idx').using(
            'btree',
            table.username.asc().nullsLast().op('text_ops'),
        ),
    ],
);
export const nas = pgTable(
    'nas',
    {
        id: serial().primaryKey().notNull(),
        nasname: text().notNull(),
        shortname: text().notNull(),
        type: text().default('other').notNull(),
        ports: integer(),
        secret: text().notNull(),
        server: text(),
        community: text(),
        description: text(),
    },
    (table) => [
        index('nas_nasname').using(
            'btree',
            table.nasname.asc().nullsLast().op('text_ops'),
        ),
    ],
);
