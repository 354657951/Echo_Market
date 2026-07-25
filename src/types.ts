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
