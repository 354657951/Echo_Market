import seedProducts from '../../data/seed-products.json'
import { withBase } from '../config/runtime'
import type { Product } from '../types/market'

// 课程演示与共享数据库使用同一份初始商品，避免本地和线上基线漂移。
export const products = (seedProducts as Product[]).map((product) => ({
  ...product,
  image: withBase(product.image),
}))

// “全部”仅用于筛选器，不会作为商品自身分类写入数据。
export const categories = ['全部', '数码', '学习', '生活', '运动', '影音'] as const
