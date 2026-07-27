import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  usernameNormalized: text('username_normalized').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('users_username_normalized_idx').on(table.usernameNormalized)])

export const refreshSessions = sqliteTable('refresh_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
}, (table) => [index('refresh_sessions_user_id_idx').on(table.userId)])

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  title: text('title').notNull(), category: text('category').notNull(), description: text('description').notNull(),
  price: integer('price').notNull(), condition: text('condition').notNull(), campus: text('campus').notNull(),
  seller: text('seller').notNull(), sellerId: text('seller_id').references(() => users.id), image: text('image').notNull(),
  tagsJson: text('tags_json').notNull(), postedAt: text('posted_at').notNull(), createdAt: text('created_at').notNull(), source: text('source').notNull().default('shared'),
})

export const userFavorites = sqliteTable('user_favorites', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  updatedAt: text('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.productId] })])

export const userCartItems = sqliteTable('user_cart_items', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.productId] })])

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(), userId: text('user_id').references(() => users.id), payloadJson: text('payload_json').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [index('orders_user_id_idx').on(table.userId)])

export const storeMeta = sqliteTable('store_meta', { key: text('key').primaryKey(), value: text('value').notNull(), updatedAt: text('updated_at').notNull() })
