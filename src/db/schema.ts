// src/db/schema.ts
import { jsonb, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from 'drizzle-zod';
import z from 'zod';

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  chatId: text('chatId').notNull(),
  messageId: text('messageId').notNull(),
  role: text('role', { enum: ['assistant', 'user'] }).notNull(),
  metadata: jsonb('metadata'),
});

export const MessagesInsertSchema = createInsertSchema(messages);

export type MessageInsert = typeof messages["$inferInsert"];


export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: text('createdAt').notNull(),
  focusMode: text('focusMode').notNull(),
});

export const insertChatSchema = createInsertSchema(chats);

export type InsertChat = z.infer<typeof insertChatSchema>;
