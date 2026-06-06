/**
 * Shared result shape for every notification send attempt. Returned by each
 * channel sender and written to notification_deliveries so the dashboard can
 * show exactly what happened (and why, when nothing fired).
 */
export interface NotifyResult {
  status: "sent" | "skipped" | "failed";
  /** Display-only target: email address, Slack channel, or webhook host. Never a secret. */
  target?: string;
  /** Reason for skip / error detail. */
  detail?: string;
}

export type NotificationChannel = "email" | "slack" | "webhook" | "quo";
