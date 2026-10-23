-- 423.rent — Supabase schema
-- Run once in Supabase → SQL Editor (or via the CLI). Safe to re-run.
--
-- The server talks to these tables with the service-role key, which bypasses
-- Row Level Security. RLS is turned ON with no policies, so the public anon key
-- can never read or write them directly.

create table if not exists r423_users (
  id          text primary key,
  email       text unique not null,
  salt        text not null,
  pass_hash   text not null,
  name        text not null default '',
  role        text not null default 'rentee' check (role in ('rentee','renters','rentplus')),
  bio         text not null default '',
  tagline     text not null default '',
  avatar      text not null default '',
  location    text,
  extra       jsonb not null default '{}'::jsonb,   -- phone, cover, interests
  created_at  bigint not null
);

create table if not exists r423_sessions (
  token_hash  text primary key,                      -- sha256 of the bearer token
  user_id     text not null,                         -- '__admin__' for admin sessions
  admin       boolean not null default false,
  exp         bigint not null
);
create index if not exists sessions_exp_idx on r423_sessions (exp);

create table if not exists r423_listings (
  id          text primary key,
  owner_id    text not null,
  data        jsonb not null,                        -- title, price, images, desc, ...
  created_at  bigint not null
);
create index if not exists listings_owner_idx on r423_listings (owner_id);
create index if not exists listings_created_idx on r423_listings (created_at desc);

create table if not exists r423_scores (
  user_id     text not null,
  game        text not null check (game in ('trivia','agent','keys')),
  level       integer not null default 0,
  primary key (user_id, game)
);

create table if not exists r423_messages (
  id          bigserial primary key,
  from_id     text not null,
  to_id       text not null,
  text        text not null,
  ts          bigint not null,
  read        boolean not null default false
);
create index if not exists messages_to_idx   on r423_messages (to_id, from_id, ts);
create index if not exists messages_from_idx on r423_messages (from_id, to_id, ts);

create table if not exists r423_agreements (
  agr_id       text primary key,
  listing_id   text not null,
  owner_id     text not null default '',
  renter_id    text not null,
  renter_name  text not null default '',
  title        text not null default '',
  rent         numeric(12,2) not null default 0,
  fee          numeric(12,2) not null default 0,
  deposit      numeric(12,2) not null default 0,
  total        numeric(12,2) not null,
  start_date   text,
  end_date     text,
  qty          integer not null default 1,
  status       text not null default 'Sent to lister'
               check (status in ('Sent to lister','Accepted','Declined','Cancelled','Paid')),
  signed_at    bigint not null,
  paid_at      bigint
);
create index if not exists agreements_renter_idx on r423_agreements (renter_id, signed_at desc);
create index if not exists agreements_owner_idx  on r423_agreements (owner_id,  signed_at desc);

create table if not exists r423_reviews (
  id          bigserial primary key,
  listing_id  text not null,
  agr_id      text not null unique,                  -- one review per rental
  user_id     text not null,
  rating      integer not null check (rating between 1 and 5),
  text        text not null,
  by_name     text not null default '',
  date        bigint not null
);
create index if not exists reviews_listing_idx on r423_reviews (listing_id, date desc);

create table if not exists r423_payments (
  agr_id      text primary key,
  amount      numeric(12,2),
  receipt_id  text,
  session_id  text,
  paid_at     bigint not null
);

-- lock every table to the service role
alter table r423_users      enable row level security;
alter table r423_sessions   enable row level security;
alter table r423_listings   enable row level security;
alter table r423_scores     enable row level security;
alter table r423_messages   enable row level security;
alter table r423_agreements enable row level security;
alter table r423_reviews    enable row level security;
alter table r423_payments   enable row level security;
