variable "account_id" {
  description = "Cloudflare account identifier for the target environment. Do not commit live values."
  type        = string
}

variable "environment" {
  description = "Environment label such as dev or prod."
  type        = string
}

variable "worker_name" {
  description = "Wrangler worker name for the catalog app."
  type        = string
}

variable "d1_database_name" {
  description = "D1 database name."
  type        = string
}

variable "r2_bucket_name" {
  description = "Private R2 bucket used for transcript originals."
  type        = string
}

variable "queue_name" {
  description = "Queue used for reconciliation jobs."
  type        = string
}
