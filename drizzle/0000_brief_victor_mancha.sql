CREATE TABLE `cart_items` (
	`product_id` text PRIMARY KEY NOT NULL,
	`quantity` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`product_id` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`condition` text NOT NULL,
	`campus` text NOT NULL,
	`seller` text NOT NULL,
	`image` text NOT NULL,
	`tags_json` text NOT NULL,
	`posted_at` text NOT NULL,
	`created_at` text NOT NULL,
	`source` text DEFAULT 'shared' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
