-- The reminder email is the product, for suppliers: hundreds of companies who
-- will never sign in form their entire impression of ZenoSource from it. It
-- needs an envelope (who it's from, who a reply reaches) and an HTML body,
-- neither of which the capture table could hold.

-- AlterTable
ALTER TABLE "CapturedEmail" ADD COLUMN     "fromEmail" TEXT NOT NULL DEFAULT 'notifications@zenosource.example',
ADD COLUMN     "fromName" TEXT NOT NULL DEFAULT 'ZenoSource',
ADD COLUMN     "htmlBody" TEXT,
ADD COLUMN     "previewText" TEXT,
ADD COLUMN     "replyTo" TEXT;
