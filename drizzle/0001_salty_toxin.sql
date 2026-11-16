CREATE TABLE "switch_trust_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"cloudhike_run_id" text,
	"switch_trust_run_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"score" integer,
	"report" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "switch_trust_scans" ADD CONSTRAINT "switch_trust_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "switch_trust_scans" ADD CONSTRAINT "switch_trust_scans_agent_id_workspace_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspace_agents"("id") ON DELETE cascade ON UPDATE no action;