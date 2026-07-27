import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 商品是共享集市的事实来源。初始商品与组员发布的商品都进入同一张表，
 * 便于跨设备筛选、详情展示和交易记录引用。
 */
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  price: integer('price').notNull(),
  condition: text('condition').notNull(),
  campus: text('campus').notNull(),
  seller: text('seller').notNull(),
  image: text('image').notNull(),
  tagsJson: text('tags_json').notNull(),
  postedAt: text('posted_at').notNull(),
  createdAt: text('created_at').notNull(),
  source: text('source').notNull().default('shared'),
})

/**
 * 小组统一使用管理员账号，因此收藏和清单按一个共享工作区保存。
 */
export const favorites = sqliteTable('favorites', {
  productId: text('product_id').primaryKey(),
  updatedAt: text('updated_at').notNull(),
})

export const cartItems = sqliteTable('cart_items', {
  productId: text('product_id').primaryKey(),
  quantity: integer('quantity').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * 确认单保存生成当时的商品快照，之后商品信息变化也不会破坏历史记录。
 */
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  payloadJson: text('payload_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const storeMeta = sqliteTable('store_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})
