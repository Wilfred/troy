import "reflect-metadata";
import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text", default: "cli" })
  source!: string;

  @Column({ type: "text" })
  prompt!: string;

  @Column({ type: "text" })
  response!: string;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "text", nullable: true })
  entries!: string | null;

  // JSON-encoded ChatMessage[] for this turn (user prompt, assistant
  // turns with tool calls, and tool results). Used to replay full
  // tool-call history into subsequent turns.
  @Column({ type: "text", nullable: true })
  messages!: string | null;

  @Index()
  @Column({ type: "text", default: () => "(datetime('now'))" })
  created_at!: string;
}

@Entity("reminders")
export class Reminder {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "text" })
  remind_at!: string;

  @Column({ type: "text", default: () => "(datetime('now'))" })
  created_at!: string;

  @Column({ type: "integer", default: 0 })
  delivered!: number;

  @Column({ type: "text", default: "cli" })
  source!: string;
}
