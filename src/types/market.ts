/**
 * 集市领域模型。
 * 页面、全局状态和服务端返回值统一复用这些类型，避免字段定义分散。
 */
export type Category = '全部' | '数码' | '学习' | '生活' | '运动' | '影音'

export interface Product {
  id: string
  title: string
  category: Exclude<Category, '全部'>
  description: string
  price: number
  condition: string
  campus: string
  seller: string
  isOwner?: boolean
  image: string
  tags: string[]
  postedAt: string
}

export interface ListingDraft {
  rawDescription: string
  title: string
  category: Exclude<Category, '全部'>
  description: string
  price: string
  condition: string
  tags: string
  image: string
}

export interface OrderItem {
  product: Product
  quantity: number
}

export interface Order {
  id: string
  createdAt: string
  total: number
  status: '待与卖家确认' | '已确认见面'
  pickup: string
  contactTime: string
  items: OrderItem[]
}
