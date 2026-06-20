import "reflect-metadata";
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

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
