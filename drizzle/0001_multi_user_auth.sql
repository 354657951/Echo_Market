CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL,
  `username_normalized` text NOT NULL,
  `password_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_normalized_idx` ON `users` (`username_normalized`);
--> statement-breakpoint
INSERT INTO `users` (`id`,`username`,`username_normalized`,`password_hash`,`created_at`,`updated_at`)
VALUES ('legacy-campus','campus','campus','$disabled$',datetime('now'),datetime('now'));
--> statement-breakpoint
CREATE TABLE `refresh_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` text NOT NULL,
  `last_used_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `refresh_sessions_user_id_idx` ON `refresh_sessions` (`user_id`);
--> statement-breakpoint
ALTER TABLE `products` ADD `seller_id` text REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `orders` ADD `user_id` text REFERENCES `users`(`id`);
--> statement-breakpoint
CREATE INDEX `orders_user_id_idx` ON `orders` (`user_id`);
--> statement-breakpoint
CREATE TABLE `user_favorites` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `product_id` text NOT NULL REFERENCES `products`(`id`) ON DELETE CASCADE,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`user_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `user_cart_items` (
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `product_id` text NOT NULL REFERENCES `products`(`id`) ON DELETE CASCADE,
  `quantity` integer NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`user_id`,`product_id`)
);
--> statement-breakpoint
UPDATE `products` SET `seller_id`='legacy-campus' WHERE `source` IN ('shared','legacy');
--> statement-breakpoint
UPDATE `orders` SET `user_id`='legacy-campus' WHERE `user_id` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `user_favorites` (`user_id`,`product_id`,`updated_at`)
SELECT 'legacy-campus',`product_id`,`updated_at` FROM `favorites`;
--> statement-breakpoint
INSERT OR IGNORE INTO `user_cart_items` (`user_id`,`product_id`,`quantity`,`updated_at`)
SELECT 'legacy-campus',`product_id`,`quantity`,`updated_at` FROM `cart_items`;
