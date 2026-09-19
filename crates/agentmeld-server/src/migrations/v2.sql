-- v2: the run row carries its turn generation (the seam's generation field).
-- v1 shipped without the column while run_row_locked selected it.
ALTER TABLE runs ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
