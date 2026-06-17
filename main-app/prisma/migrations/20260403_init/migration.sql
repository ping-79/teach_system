-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('admin', 'teacher') NOT NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `teacherProfileId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_teacherProfileId_key`(`teacherProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TeacherProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `college` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TeacherProfile_employeeNo_key`(`employeeNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Semester` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `schoolYear` VARCHAR(191) NOT NULL,
    `termNumber` INTEGER NOT NULL,
    `teachingStartDate` DATETIME(3) NOT NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Semester_schoolYear_termNumber_key`(`schoolYear`, `termNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimetableImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `semesterId` INTEGER NOT NULL,
    `teacherId` INTEGER NOT NULL,
    `sourceFilename` VARCHAR(191) NOT NULL,
    `storedPath` VARCHAR(191) NOT NULL,
    `parseStatus` ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `rawSummary` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimetableSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `importId` INTEGER NOT NULL,
    `teacherId` INTEGER NOT NULL,
    `semesterId` INTEGER NOT NULL,
    `courseName` VARCHAR(191) NOT NULL,
    `normalizedCourseName` VARCHAR(191) NOT NULL,
    `className` VARCHAR(191) NOT NULL,
    `weekday` INTEGER NOT NULL,
    `weekdayLabel` VARCHAR(191) NOT NULL,
    `periodText` VARCHAR(191) NOT NULL,
    `weekRuleRaw` VARCHAR(191) NOT NULL,
    `campus` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `studentCount` INTEGER NULL,
    `courseTotalHours` INTEGER NULL,
    `rawCellText` VARCHAR(191) NOT NULL,
    `isPracticeHint` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseOffering` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teacherId` INTEGER NOT NULL,
    `semesterId` INTEGER NOT NULL,
    `courseName` VARCHAR(191) NOT NULL,
    `normalizedCourseName` VARCHAR(191) NOT NULL,
    `className` VARCHAR(191) NOT NULL,
    `courseTotalHours` INTEGER NULL,
    `sourceImportId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CourseOffering_teacherId_semesterId_normalizedCourseName_cla_key`(`teacherId`, `semesterId`, `normalizedCourseName`, `className`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseContentLibrary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teacherId` INTEGER NOT NULL,
    `courseName` VARCHAR(191) NOT NULL,
    `normalizedCourseName` VARCHAR(191) NOT NULL,
    `sourceFilename` VARCHAR(191) NOT NULL,
    `sourceStoredPath` VARCHAR(191) NULL,
    `extractedText` VARCHAR(191) NULL,
    `draftItemsJson` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'ACTIVE') NOT NULL DEFAULT 'DRAFT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CourseContentLibrary_teacherId_normalizedCourseName_key`(`teacherId`, `normalizedCourseName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseContentItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `libraryId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `topicTitle` VARCHAR(191) NOT NULL,
    `suggestedHours` DOUBLE NULL,
    `mode` ENUM('theory', 'practice', 'mixed') NOT NULL DEFAULT 'theory',
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `offeringId` INTEGER NOT NULL,
    `type` ENUM('teaching', 'practice') NOT NULL,
    `status` ENUM('DRAFT', 'READY') NOT NULL DEFAULT 'DRAFT',
    `totalHours` DOUBLE NULL,
    `theoryHours` DOUBLE NULL,
    `practiceHours` DOUBLE NULL,
    `weeklyHours` DOUBLE NULL,
    `metadataJson` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlanDocument_offeringId_type_key`(`offeringId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanRow` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `documentId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `weekIndex` INTEGER NULL,
    `dateText` VARCHAR(191) NULL,
    `periodText` VARCHAR(191) NULL,
    `topicText` VARCHAR(191) NULL,
    `hours` DOUBLE NULL,
    `mode` ENUM('theory', 'practice', 'mixed') NOT NULL DEFAULT 'theory',
    `theoryHours` DOUBLE NULL,
    `practiceHours` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiTaskLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teacherId` INTEGER NULL,
    `taskType` ENUM('CONTENT_PARSE', 'PLAN_REVIEW') NOT NULL,
    `status` ENUM('SUCCESS', 'FAILED', 'SKIPPED') NOT NULL,
    `inputSummary` VARCHAR(191) NULL,
    `outputSummary` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_teacherProfileId_fkey` FOREIGN KEY (`teacherProfileId`) REFERENCES `TeacherProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimetableImport` ADD CONSTRAINT `TimetableImport_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimetableImport` ADD CONSTRAINT `TimetableImport_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `TeacherProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimetableSession` ADD CONSTRAINT `TimetableSession_importId_fkey` FOREIGN KEY (`importId`) REFERENCES `TimetableImport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimetableSession` ADD CONSTRAINT `TimetableSession_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `TeacherProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TimetableSession` ADD CONSTRAINT `TimetableSession_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseOffering` ADD CONSTRAINT `CourseOffering_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `TeacherProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseOffering` ADD CONSTRAINT `CourseOffering_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `Semester`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseContentLibrary` ADD CONSTRAINT `CourseContentLibrary_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `TeacherProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseContentItem` ADD CONSTRAINT `CourseContentItem_libraryId_fkey` FOREIGN KEY (`libraryId`) REFERENCES `CourseContentLibrary`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanDocument` ADD CONSTRAINT `PlanDocument_offeringId_fkey` FOREIGN KEY (`offeringId`) REFERENCES `CourseOffering`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanRow` ADD CONSTRAINT `PlanRow_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `PlanDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiTaskLog` ADD CONSTRAINT `AiTaskLog_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `TeacherProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

