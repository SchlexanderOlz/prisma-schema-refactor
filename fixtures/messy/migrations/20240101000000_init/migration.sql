-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('PERMANENT', 'FIXED_TERM', 'FREELANCE', 'INTERNSHIP');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'VISIT');

-- CreateEnum
CREATE TYPE "AttributeKind" AS ENUM ('TEXT', 'NUMBER', 'FLAG');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('RECEIPT', 'TRANSFER', 'ISSUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('CARD', 'SEPA_DEBIT', 'BANK_TRANSFER', 'WALLET');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "TrackingEventKind" AS ENUM ('PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('LEAD', 'CONTRIBUTOR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('NEWSLETTER', 'PROFILING', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "roleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCredential" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaSecret" TEXT,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "departmentCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" INTEGER,
    "costCenter" TEXT,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "positionCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "minSalary" DECIMAL(12,2),
    "maxSalary" DECIMAL(12,2),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "workEmail" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "positionId" INTEGER NOT NULL,
    "managerId" INTEGER,
    "userId" INTEGER,
    "hiredOn" DATE NOT NULL,
    "terminatedOn" DATE,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "dateOfBirth" DATE,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentContract" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "weeklyHours" DECIMAL(4,1),
    "annualSalary" DECIMAL(12,2) NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploymentContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceType" (
    "id" SERIAL NOT NULL,
    "typeCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL,

    CONSTRAINT "AbsenceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "absenceTypeId" INTEGER NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" DATE NOT NULL,
    "approvedById" INTEGER,
    "note" TEXT,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "leadId" INTEGER,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "teamId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "joinedOn" DATE NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("teamId","employeeId")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSkill" (
    "employeeId" INTEGER NOT NULL,
    "skillId" INTEGER NOT NULL,
    "proficiency" INTEGER NOT NULL,

    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("employeeId","skillId")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "reviewer_id" INTEGER NOT NULL,
    "review_date" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "summary" TEXT,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" SERIAL NOT NULL,
    "holidayDate" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "isHalfDay" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" SERIAL NOT NULL,
    "industryCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "phone" TEXT,
    "vatId" TEXT,
    "industryId" INTEGER,
    "accountManagerId" INTEGER,
    "creditLimit" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCompany" (
    "id" SERIAL NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "phone" TEXT,
    "vatId" TEXT,
    "industryId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "emailAddress" TEXT,
    "jobTitle" TEXT,
    "phone1" TEXT,
    "phone2" TEXT,
    "phone3" TEXT,
    "isPrimary" BOOLEAN NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "isDefaultShipping" BOOLEAN NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" SERIAL NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT,
    "companyName" TEXT,
    "emailAddress" TEXT,
    "leadSourceId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "ownerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "winProbability" INTEGER NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "stageId" INTEGER NOT NULL,
    "expectedValue" DECIMAL(12,2) NOT NULL,
    "expectedCloseOn" DATE,
    "ownerId" INTEGER,
    "competitorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" SERIAL NOT NULL,
    "activityKind" "ActivityKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "contactId" INTEGER,
    "opportunityId" INTEGER,
    "employeeId" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNote" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" SERIAL NOT NULL,
    "companyName" TEXT NOT NULL,
    "websiteUrl" TEXT,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" SERIAL NOT NULL,
    "brandName" TEXT NOT NULL,
    "websiteUrl" TEXT,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "productNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "imageUrl1" TEXT,
    "imageUrl2" TEXT,
    "imageUrl3" TEXT,
    "brandId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDimensions" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,

    CONSTRAINT "ProductDimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" SERIAL NOT NULL,
    "uomCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "uomId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "productId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" SERIAL NOT NULL,
    "attributeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "valueKind" "AttributeKind" NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttributeValue" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "attributeId" INTEGER NOT NULL,
    "valueText" TEXT NOT NULL,

    CONSTRAINT "ProductAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "tagText" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTag" (
    "productId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("productId","tagId")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "currencyId" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListEntry" (
    "id" SERIAL NOT NULL,
    "priceListId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PriceListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" SERIAL NOT NULL,
    "warehouseCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "locationCode" TEXT NOT NULL,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" SERIAL NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "storageLocationId" INTEGER NOT NULL,
    "quantityOnHand" INTEGER NOT NULL,
    "quantityReserved" INTEGER NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "fromLocationId" INTEGER,
    "toLocationId" INTEGER,
    "movementKind" "MovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stocktake" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "countedOn" DATE NOT NULL,
    "status" "StocktakeStatus" NOT NULL,

    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StocktakeLine" (
    "id" SERIAL NOT NULL,
    "stocktakeId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "countedQuantity" INTEGER NOT NULL,

    CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT,
    "paymentTermId" INTEGER,
    "websiteUrl" TEXT,
    "ratingScore" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" SERIAL NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT,
    "paymentTermId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "purchaseOrderNumber" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3),
    "expectedOn" DATE,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" SERIAL NOT NULL,
    "purchaseOrderId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "orderedQuantity" TEXT NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesChannel" (
    "id" SERIAL NOT NULL,
    "channelKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "SalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER,
    "salesChannelId" INTEGER NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" SERIAL NOT NULL,
    "cartId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" SERIAL NOT NULL,
    "orderReference" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "salesChannelId" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "currencyId" INTEGER NOT NULL,
    "shippingAddressId" INTEGER,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "salesOrderId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" SERIAL NOT NULL,
    "discountCode" TEXT NOT NULL,
    "percentOff" DECIMAL(5,2),
    "amountOff" DECIMAL(12,2),
    "validFrom" DATE NOT NULL,
    "validUntil" DATE,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRedemption" (
    "id" SERIAL NOT NULL,
    "discountId" INTEGER NOT NULL,
    "salesOrderId" INTEGER NOT NULL,
    "amountApplied" DECIMAL(12,2) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" SERIAL NOT NULL,
    "returnReference" TEXT NOT NULL,
    "salesOrderId" INTEGER NOT NULL,
    "status" "ReturnStatus" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" SERIAL NOT NULL,
    "returnRequestId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "conditionNote" TEXT,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusChange" (
    "id" SERIAL NOT NULL,
    "salesOrderId" INTEGER NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" SERIAL NOT NULL,
    "isoCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "minorUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" SERIAL NOT NULL,
    "taxCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "validFrom" DATE NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTerm" (
    "id" SERIAL NOT NULL,
    "termCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "netDays" INTEGER NOT NULL,

    CONSTRAINT "PaymentTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" SERIAL NOT NULL,
    "accountReference" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "paymentTermId" INTEGER NOT NULL,
    "invoiceEmail" TEXT NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" SERIAL NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "billingAccountId" INTEGER NOT NULL,
    "salesOrderId" INTEGER,
    "currencyId" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "issuedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "billingName" TEXT NOT NULL,
    "billingStreet" TEXT NOT NULL,
    "billingPostalCode" TEXT NOT NULL,
    "billingCity" TEXT NOT NULL,
    "totalNet" DECIMAL(12,2) NOT NULL,
    "totalTax" DECIMAL(12,2) NOT NULL,
    "totalGross" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "lineText" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRateId" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" SERIAL NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "issuedOn" DATE NOT NULL,
    "memo" TEXT,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteLine" (
    "id" SERIAL NOT NULL,
    "creditNoteId" INTEGER NOT NULL,
    "lineText" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningLevel" (
    "id" SERIAL NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL,
    "daysOverdue" INTEGER NOT NULL,

    CONSTRAINT "DunningLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DunningNotice" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "dunningLevelId" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DunningNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProvider" (
    "id" SERIAL NOT NULL,
    "providerKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "PaymentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" SERIAL NOT NULL,
    "billingAccountId" INTEGER NOT NULL,
    "paymentProviderId" INTEGER NOT NULL,
    "methodKind" "PaymentMethodKind" NOT NULL,
    "maskedReference" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "billingAccountId" INTEGER NOT NULL,
    "paymentMethodId" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyId" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "allocatedAmount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "refundNote" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" SERIAL NOT NULL,
    "payoutReference" TEXT NOT NULL,
    "paymentProviderId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currencyId" INTEGER NOT NULL,
    "paidOutAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carrier" (
    "id" SERIAL NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trackingUrlTemplate" TEXT,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierService" (
    "id" SERIAL NOT NULL,
    "carrierId" INTEGER NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "CarrierService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" SERIAL NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" SERIAL NOT NULL,
    "shippingZoneId" INTEGER NOT NULL,
    "carrierServiceId" INTEGER NOT NULL,
    "maxWeightGrams" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" SERIAL NOT NULL,
    "salesOrderId" INTEGER NOT NULL,
    "carrierServiceId" INTEGER NOT NULL,
    "customerAddressId" INTEGER NOT NULL,
    "trackingCode" TEXT,
    "shippedAt" TIMESTAMP(3),
    "shipToName" TEXT NOT NULL,
    "shipToStreet" TEXT NOT NULL,
    "shipToPostalCode" TEXT NOT NULL,
    "shipToCity" TEXT NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parcel" (
    "id" SERIAL NOT NULL,
    "weightGrams" INTEGER NOT NULL,
    "parcelLabel" TEXT,

    CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentParcel" (
    "shipmentId" INTEGER NOT NULL,
    "parcelId" INTEGER NOT NULL,

    CONSTRAINT "ShipmentParcel_pkey" PRIMARY KEY ("shipmentId","parcelId")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" SERIAL NOT NULL,
    "parcelId" INTEGER NOT NULL,
    "carrierId" INTEGER NOT NULL,
    "eventKind" "TrackingEventKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "locationText" TEXT,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" SERIAL NOT NULL,
    "shipmentId" INTEGER NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "failureNote" TEXT,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportQueue" (
    "id" SERIAL NOT NULL,
    "queueKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "SupportQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCategory" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketLabel" (
    "id" SERIAL NOT NULL,
    "labelText" TEXT NOT NULL,
    "colorHex" TEXT NOT NULL,
    "createdById" INTEGER,

    CONSTRAINT "TicketLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" SERIAL NOT NULL,
    "ticketReference" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "customerId" INTEGER,
    "queueId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "slaPolicyId" INTEGER,
    "assigneeId" INTEGER,
    "status" TEXT NOT NULL,
    "labelIds" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorEmployeeId" INTEGER,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CannedResponses" (
    "id" SERIAL NOT NULL,
    "queue_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "response_body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CannedResponses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "projectCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" INTEGER,
    "templateId" INTEGER,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "budget" DECIMAL(12,2),
    "milestones" JSONB,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "projectRole" "ProjectRole" NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","employeeId")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "projectTitle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "assigneeId" INTEGER,
    "dueOn" DATE,
    "isDone" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" INTEGER NOT NULL,
    "dependsOnTaskId" INTEGER NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnTaskId")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "workDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentMembership" (
    "segmentId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentMembership_pkey" PRIMARY KEY ("segmentId","customerId")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "budget" DECIMAL(12,2),
    "segmentIds" TEXT,
    "ownerId" INTEGER,
    "emailTemplateId" INTEGER,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" SERIAL NOT NULL,
    "templateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Newsletter" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Newsletter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSubscription" (
    "id" SERIAL NOT NULL,
    "newsletterId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "subscribedAt" TIMESTAMP(3) NOT NULL,
    "unsubscribedAt" TIMESTAMP(3),
    "doubleOptIn" TEXT NOT NULL,

    CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConsent" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "consentPurpose" "ConsentPurpose" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" INTEGER,
    "ownerId" INTEGER NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "folderId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentShare" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "sharedWithUserId" INTEGER NOT NULL,
    "canEdit" BOOLEAN NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" SERIAL NOT NULL,
    "templateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "NotificationChannel" NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "title" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" SERIAL NOT NULL,
    "settingKey" TEXT NOT NULL,
    "configData" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" SERIAL NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_emailAddress_key" ON "User"("emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Role_roleKey_key" ON "Role"("roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_permissionKey_key" ON "Permission"("permissionKey");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCredential_userId_key" ON "UserCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_departmentCode_key" ON "Department"("departmentCode");

-- CreateIndex
CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_positionCode_key" ON "Position"("positionCode");

-- CreateIndex
CREATE INDEX "Position_departmentId_idx" ON "Position"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_workEmail_key" ON "Employee"("workEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE INDEX "Employee_positionId_idx" ON "Employee"("positionId");

-- CreateIndex
CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeProfile_employeeId_key" ON "EmployeeProfile"("employeeId");

-- CreateIndex
CREATE INDEX "EmploymentContract_employeeId_idx" ON "EmploymentContract"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceType_typeCode_key" ON "AbsenceType"("typeCode");

-- CreateIndex
CREATE INDEX "Absence_employeeId_idx" ON "Absence"("employeeId");

-- CreateIndex
CREATE INDEX "Absence_absenceTypeId_idx" ON "Absence"("absenceTypeId");

-- CreateIndex
CREATE INDEX "Absence_approvedById_idx" ON "Absence"("approvedById");

-- CreateIndex
CREATE INDEX "Team_departmentId_idx" ON "Team"("departmentId");

-- CreateIndex
CREATE INDEX "Team_leadId_idx" ON "Team"("leadId");

-- CreateIndex
CREATE INDEX "TeamMembership_employeeId_idx" ON "TeamMembership"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_title_key" ON "Skill"("title");

-- CreateIndex
CREATE INDEX "EmployeeSkill_skillId_idx" ON "EmployeeSkill"("skillId");

-- CreateIndex
CREATE INDEX "performance_reviews_employee_id_idx" ON "performance_reviews"("employee_id");

-- CreateIndex
CREATE INDEX "performance_reviews_reviewer_id_idx" ON "performance_reviews"("reviewer_id");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_holidayDate_key" ON "PublicHoliday"("holidayDate");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_industryCode_key" ON "Industry"("industryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNumber_key" ON "Customer"("customerNumber");

-- CreateIndex
CREATE INDEX "Customer_industryId_idx" ON "Customer"("industryId");

-- CreateIndex
CREATE INDEX "Customer_accountManagerId_idx" ON "Customer"("accountManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCompany_customerNumber_key" ON "ClientCompany"("customerNumber");

-- CreateIndex
CREATE INDEX "ClientCompany_industryId_idx" ON "ClientCompany"("industryId");

-- CreateIndex
CREATE INDEX "Contact_customerId_idx" ON "Contact"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_sourceKey_key" ON "LeadSource"("sourceKey");

-- CreateIndex
CREATE INDEX "Lead_leadSourceId_idx" ON "Lead"("leadSourceId");

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_sortOrder_key" ON "PipelineStage"("sortOrder");

-- CreateIndex
CREATE INDEX "Opportunity_customerId_idx" ON "Opportunity"("customerId");

-- CreateIndex
CREATE INDEX "Opportunity_stageId_idx" ON "Opportunity"("stageId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_competitorId_idx" ON "Opportunity"("competitorId");

-- CreateIndex
CREATE INDEX "Activity_opportunityId_idx" ON "Activity"("opportunityId");

-- CreateIndex
CREATE INDEX "Activity_employeeId_idx" ON "Activity"("employeeId");

-- CreateIndex
CREATE INDEX "CrmNote_customerId_idx" ON "CrmNote"("customerId");

-- CreateIndex
CREATE INDEX "CrmNote_authorId_idx" ON "CrmNote"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_brandName_key" ON "Brand"("brandName");

-- CreateIndex
CREATE UNIQUE INDEX "Category_categorySlug_key" ON "Category"("categorySlug");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_productNumber_key" ON "Product"("productNumber");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDimensions_productId_key" ON "ProductDimensions"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_uomCode_key" ON "UnitOfMeasure"("uomCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductVariant_uomId_idx" ON "ProductVariant"("uomId");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_idx" ON "ProductCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinition_attributeKey_key" ON "AttributeDefinition"("attributeKey");

-- CreateIndex
CREATE INDEX "ProductAttributeValue_attributeId_idx" ON "ProductAttributeValue"("attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttributeValue_productId_attributeId_key" ON "ProductAttributeValue"("productId", "attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_tagText_key" ON "Tag"("tagText");

-- CreateIndex
CREATE INDEX "ProductTag_tagId_idx" ON "ProductTag"("tagId");

-- CreateIndex
CREATE INDEX "PriceList_currencyId_idx" ON "PriceList"("currencyId");

-- CreateIndex
CREATE INDEX "PriceListEntry_productVariantId_idx" ON "PriceListEntry"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListEntry_priceListId_productVariantId_key" ON "PriceListEntry"("priceListId", "productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_warehouseCode_key" ON "Warehouse"("warehouseCode");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_warehouseId_locationCode_key" ON "StorageLocation"("warehouseId", "locationCode");

-- CreateIndex
CREATE INDEX "StockLevel_storageLocationId_idx" ON "StockLevel"("storageLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_productVariantId_storageLocationId_key" ON "StockLevel"("productVariantId", "storageLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_productVariantId_idx" ON "StockMovement"("productVariantId");

-- CreateIndex
CREATE INDEX "StockMovement_fromLocationId_idx" ON "StockMovement"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_toLocationId_idx" ON "StockMovement"("toLocationId");

-- CreateIndex
CREATE INDEX "Stocktake_warehouseId_idx" ON "Stocktake"("warehouseId");

-- CreateIndex
CREATE INDEX "StocktakeLine_stocktakeId_idx" ON "StocktakeLine"("stocktakeId");

-- CreateIndex
CREATE INDEX "StocktakeLine_warehouseId_idx" ON "StocktakeLine"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierCode_key" ON "Supplier"("supplierCode");

-- CreateIndex
CREATE INDEX "Supplier_paymentTermId_idx" ON "Supplier"("paymentTermId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_supplierCode_key" ON "Vendor"("supplierCode");

-- CreateIndex
CREATE INDEX "Vendor_paymentTermId_idx" ON "Vendor"("paymentTermId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_purchaseOrderNumber_key" ON "PurchaseOrder"("purchaseOrderNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_warehouseId_idx" ON "PurchaseOrder"("warehouseId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_productVariantId_idx" ON "PurchaseOrderLine"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesChannel_channelKey_key" ON "SalesChannel"("channelKey");

-- CreateIndex
CREATE INDEX "Cart_customerId_idx" ON "Cart"("customerId");

-- CreateIndex
CREATE INDEX "Cart_salesChannelId_idx" ON "Cart"("salesChannelId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE INDEX "CartItem_productVariantId_idx" ON "CartItem"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderReference_key" ON "SalesOrder"("orderReference");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_salesChannelId_idx" ON "SalesOrder"("salesChannelId");

-- CreateIndex
CREATE INDEX "SalesOrder_currencyId_idx" ON "SalesOrder"("currencyId");

-- CreateIndex
CREATE INDEX "SalesOrder_shippingAddressId_idx" ON "SalesOrder"("shippingAddressId");

-- CreateIndex
CREATE INDEX "OrderItem_salesOrderId_idx" ON "OrderItem"("salesOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_productVariantId_idx" ON "OrderItem"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_discountCode_key" ON "Discount"("discountCode");

-- CreateIndex
CREATE INDEX "DiscountRedemption_discountId_idx" ON "DiscountRedemption"("discountId");

-- CreateIndex
CREATE INDEX "DiscountRedemption_salesOrderId_idx" ON "DiscountRedemption"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_returnReference_key" ON "ReturnRequest"("returnReference");

-- CreateIndex
CREATE INDEX "ReturnRequest_salesOrderId_idx" ON "ReturnRequest"("salesOrderId");

-- CreateIndex
CREATE INDEX "ReturnItem_returnRequestId_idx" ON "ReturnItem"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderStatusChange_salesOrderId_idx" ON "OrderStatusChange"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTerm_termCode_key" ON "PaymentTerm"("termCode");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_accountReference_key" ON "BillingAccount"("accountReference");

-- CreateIndex
CREATE INDEX "BillingAccount_customerId_idx" ON "BillingAccount"("customerId");

-- CreateIndex
CREATE INDEX "BillingAccount_paymentTermId_idx" ON "BillingAccount"("paymentTermId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_billingAccountId_idx" ON "Invoice"("billingAccountId");

-- CreateIndex
CREATE INDEX "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");

-- CreateIndex
CREATE INDEX "Invoice_currencyId_idx" ON "Invoice"("currencyId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_taxRateId_idx" ON "InvoiceLine"("taxRateId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNoteLine_creditNoteId_idx" ON "CreditNoteLine"("creditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DunningLevel_levelNumber_key" ON "DunningLevel"("levelNumber");

-- CreateIndex
CREATE INDEX "DunningNotice_invoiceId_idx" ON "DunningNotice"("invoiceId");

-- CreateIndex
CREATE INDEX "DunningNotice_dunningLevelId_idx" ON "DunningNotice"("dunningLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProvider_providerKey_key" ON "PaymentProvider"("providerKey");

-- CreateIndex
CREATE INDEX "PaymentMethod_billingAccountId_idx" ON "PaymentMethod"("billingAccountId");

-- CreateIndex
CREATE INDEX "PaymentMethod_paymentProviderId_idx" ON "PaymentMethod"("paymentProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentReference_key" ON "Payment"("paymentReference");

-- CreateIndex
CREATE INDEX "Payment_billingAccountId_idx" ON "Payment"("billingAccountId");

-- CreateIndex
CREATE INDEX "Payment_paymentMethodId_idx" ON "Payment"("paymentMethodId");

-- CreateIndex
CREATE INDEX "Payment_currencyId_idx" ON "Payment"("currencyId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_payoutReference_key" ON "Payout"("payoutReference");

-- CreateIndex
CREATE INDEX "Payout_paymentProviderId_idx" ON "Payout"("paymentProviderId");

-- CreateIndex
CREATE INDEX "Payout_currencyId_idx" ON "Payout"("currencyId");

-- CreateIndex
CREATE INDEX "Carrier_carrierCode_idx" ON "Carrier"("carrierCode");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierService_carrierId_serviceCode_key" ON "CarrierService"("carrierId", "serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_zoneCode_key" ON "ShippingZone"("zoneCode");

-- CreateIndex
CREATE INDEX "ShippingRate_shippingZoneId_idx" ON "ShippingRate"("shippingZoneId");

-- CreateIndex
CREATE INDEX "ShippingRate_carrierServiceId_idx" ON "ShippingRate"("carrierServiceId");

-- CreateIndex
CREATE INDEX "Shipment_salesOrderId_idx" ON "Shipment"("salesOrderId");

-- CreateIndex
CREATE INDEX "Shipment_carrierServiceId_idx" ON "Shipment"("carrierServiceId");

-- CreateIndex
CREATE INDEX "Shipment_customerAddressId_idx" ON "Shipment"("customerAddressId");

-- CreateIndex
CREATE INDEX "ShipmentParcel_parcelId_idx" ON "ShipmentParcel"("parcelId");

-- CreateIndex
CREATE INDEX "TrackingEvent_carrierId_idx" ON "TrackingEvent"("carrierId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_shipmentId_idx" ON "DeliveryAttempt"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportQueue_queueKey_key" ON "SupportQueue"("queueKey");

-- CreateIndex
CREATE UNIQUE INDEX "TicketCategory_title_key" ON "TicketCategory"("title");

-- CreateIndex
CREATE INDEX "TicketCategory_parentId_idx" ON "TicketCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketLabel_labelText_key" ON "TicketLabel"("labelText");

-- CreateIndex
CREATE INDEX "TicketLabel_createdById_idx" ON "TicketLabel"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketReference_key" ON "Ticket"("ticketReference");

-- CreateIndex
CREATE INDEX "Ticket_customerId_idx" ON "Ticket"("customerId");

-- CreateIndex
CREATE INDEX "Ticket_queueId_idx" ON "Ticket"("queueId");

-- CreateIndex
CREATE INDEX "Ticket_categoryId_idx" ON "Ticket"("categoryId");

-- CreateIndex
CREATE INDEX "Ticket_slaPolicyId_idx" ON "Ticket"("slaPolicyId");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_idx" ON "TicketMessage"("ticketId");

-- CreateIndex
CREATE INDEX "TicketMessage_authorEmployeeId_idx" ON "TicketMessage"("authorEmployeeId");

-- CreateIndex
CREATE INDEX "CannedResponses_queue_id_idx" ON "CannedResponses"("queue_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplate_title_key" ON "ProjectTemplate"("title");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");

-- CreateIndex
CREATE INDEX "Project_templateId_idx" ON "Project"("templateId");

-- CreateIndex
CREATE INDEX "ProjectMember_employeeId_idx" ON "ProjectMember"("employeeId");

-- CreateIndex
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");

-- CreateIndex
CREATE INDEX "Segment_createdById_idx" ON "Segment"("createdById");

-- CreateIndex
CREATE INDEX "SegmentMembership_customerId_idx" ON "SegmentMembership"("customerId");

-- CreateIndex
CREATE INDEX "Campaign_ownerId_idx" ON "Campaign"("ownerId");

-- CreateIndex
CREATE INDEX "Campaign_emailTemplateId_idx" ON "Campaign"("emailTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_templateKey_key" ON "EmailTemplate"("templateKey");

-- CreateIndex
CREATE INDEX "EmailTemplate_createdById_idx" ON "EmailTemplate"("createdById");

-- CreateIndex
CREATE INDEX "NewsletterSubscription_newsletterId_idx" ON "NewsletterSubscription"("newsletterId");

-- CreateIndex
CREATE INDEX "NewsletterSubscription_contactId_idx" ON "NewsletterSubscription"("contactId");

-- CreateIndex
CREATE INDEX "MarketingConsent_contactId_idx" ON "MarketingConsent"("contactId");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "Folder_ownerId_idx" ON "Folder"("ownerId");

-- CreateIndex
CREATE INDEX "Document_folderId_idx" ON "Document"("folderId");

-- CreateIndex
CREATE INDEX "Document_createdById_idx" ON "Document"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentVersion_uploadedById_idx" ON "DocumentVersion"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_revision_key" ON "DocumentVersion"("documentId", "revision");

-- CreateIndex
CREATE INDEX "DocumentShare_sharedWithUserId_idx" ON "DocumentShare"("sharedWithUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentShare_documentId_sharedWithUserId_key" ON "DocumentShare"("documentId", "sharedWithUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_templateKey_key" ON "NotificationTemplate"("templateKey");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_templateId_idx" ON "Notification"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_channel_key" ON "NotificationPreference"("userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_settingKey_key" ON "AppSetting"("settingKey");

-- CreateIndex
CREATE INDEX "AppSetting_updatedById_idx" ON "AppSetting"("updatedById");

-- CreateIndex
CREATE INDEX "Webhook_createdById_idx" ON "Webhook"("createdById");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentContract" ADD CONSTRAINT "EmploymentContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_absenceTypeId_fkey" FOREIGN KEY ("absenceTypeId") REFERENCES "AbsenceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCompany" ADD CONSTRAINT "ClientCompany_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_leadSourceId_fkey" FOREIGN KEY ("leadSourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDimensions" ADD CONSTRAINT "ProductDimensions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttributeValue" ADD CONSTRAINT "ProductAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "AttributeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "PaymentTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "PaymentTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_salesChannelId_fkey" FOREIGN KEY ("salesChannelId") REFERENCES "SalesChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_salesChannelId_fkey" FOREIGN KEY ("salesChannelId") REFERENCES "SalesChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "CustomerAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusChange" ADD CONSTRAINT "OrderStatusChange_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_paymentTermId_fkey" FOREIGN KEY ("paymentTermId") REFERENCES "PaymentTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningNotice" ADD CONSTRAINT "DunningNotice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DunningNotice" ADD CONSTRAINT "DunningNotice_dunningLevelId_fkey" FOREIGN KEY ("dunningLevelId") REFERENCES "DunningLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_paymentProviderId_fkey" FOREIGN KEY ("paymentProviderId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_paymentProviderId_fkey" FOREIGN KEY ("paymentProviderId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierService" ADD CONSTRAINT "CarrierService_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_shippingZoneId_fkey" FOREIGN KEY ("shippingZoneId") REFERENCES "ShippingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_carrierServiceId_fkey" FOREIGN KEY ("carrierServiceId") REFERENCES "CarrierService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierServiceId_fkey" FOREIGN KEY ("carrierServiceId") REFERENCES "CarrierService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "CustomerAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentParcel" ADD CONSTRAINT "ShipmentParcel_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentParcel" ADD CONSTRAINT "ShipmentParcel_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketCategory" ADD CONSTRAINT "TicketCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TicketCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLabel" ADD CONSTRAINT "TicketLabel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "SupportQueue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CannedResponses" ADD CONSTRAINT "CannedResponses_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "SupportQueue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentMembership" ADD CONSTRAINT "SegmentMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterSubscription" ADD CONSTRAINT "NewsletterSubscription_newsletterId_fkey" FOREIGN KEY ("newsletterId") REFERENCES "Newsletter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterSubscription" ADD CONSTRAINT "NewsletterSubscription_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConsent" ADD CONSTRAINT "MarketingConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentShare" ADD CONSTRAINT "DocumentShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentShare" ADD CONSTRAINT "DocumentShare_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

