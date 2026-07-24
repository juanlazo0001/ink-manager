// Shared by every URL-safe slug this app generates (Studio.slug at
// bootstrap, IntakeForm.slug at creation) -- one real implementation, not
// two independently-written copies of the same lowercase/dash-collapse rule.
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
