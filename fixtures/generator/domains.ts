// The clean schema: a fictional mid-size company platform, 122 models in 14 domains.
// It satisfies the target rules by design. Snapshots carry `/// @snapshot:` docs.

import type { EnumDef, Field, Gen, Model, Schema } from './ir.ts'
import { parseFieldSpec } from './ir.ts'
import {
  after, bool, company, date, dec, email, fixed, fullName, hex, int, ipv4, money, phone, pick,
  sentence, seq, titleWords, ts, uniqPick, url, words,
} from './gens.ts'

type Opts = { nullRate?: number; doc?: string }
type FSpec = string | [string, Gen?, Opts?]

interface ModelOpts {
  id?: string[]
  unique?: string[][]
  index?: string[][]
}

export function model(name: string, domain: string, rows: number, spec: Record<string, FSpec>, opts: ModelOpts = {}): Model {
  const fields: Field[] = []
  if (!opts.id) fields.push({ name: 'id', type: 'Int', id: true, default: 'autoincrement()' })
  for (const [fname, raw] of Object.entries(spec)) {
    const [s, gen, o] = typeof raw === 'string' ? [raw, undefined, undefined] : raw
    const { scalar, relation } = parseFieldSpec(fname, s)
    if (gen) scalar.gen = gen
    if (o?.nullRate !== undefined) scalar.nullRate = o.nullRate
    if (o?.doc) scalar.doc = o.doc
    fields.push(scalar)
    if (relation) fields.push(relation)
  }
  const m: Model = { name, domain, rows, fields, uniques: opts.unique ?? [], indexes: opts.index ?? [] }
  if (opts.id) m.compoundId = opts.id
  addFkIndexes(m)
  return m
}

/** R14: every FK scalar gets an index unless it leads a PK/unique. */
export function addFkIndexes(m: Model): void {
  const covered = new Set<string>()
  if (m.compoundId) covered.add(m.compoundId[0])
  for (const u of m.uniques) covered.add(u[0])
  for (const ix of m.indexes) covered.add(ix[0])
  for (const f of m.fields) if (f.unique || f.id) covered.add(f.name)
  for (const rf of m.fields.filter((f) => f.relation)) {
    const fk = rf.relation!.fields[0]
    if (!covered.has(fk)) {
      m.indexes.push([fk])
      covered.add(fk)
    }
  }
}

const SNAP = (why: string) => ({ doc: `@snapshot: ${why}` })

export const ENUMS: EnumDef[] = [
  { name: 'ContractType', values: ['PERMANENT', 'FIXED_TERM', 'FREELANCE', 'INTERNSHIP'] },
  { name: 'LeadStatus', values: ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED'] },
  { name: 'ActivityKind', values: ['CALL', 'EMAIL', 'MEETING', 'VISIT'] },
  { name: 'AttributeKind', values: ['TEXT', 'NUMBER', 'FLAG'] },
  { name: 'MovementKind', values: ['RECEIPT', 'TRANSFER', 'ISSUE', 'ADJUSTMENT'] },
  { name: 'StocktakeStatus', values: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] },
  { name: 'PurchaseOrderStatus', values: ['DRAFT', 'SENT', 'CONFIRMED', 'RECEIVED', 'CANCELLED'] },
  { name: 'OrderStatus', values: ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'] },
  { name: 'ReturnStatus', values: ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'] },
  { name: 'InvoiceStatus', values: ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID'] },
  { name: 'PaymentMethodKind', values: ['CARD', 'SEPA_DEBIT', 'BANK_TRANSFER', 'WALLET'] },
  { name: 'PaymentStatus', values: ['PENDING', 'SETTLED', 'FAILED'] },
  { name: 'TrackingEventKind', values: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'] },
  { name: 'TicketStatus', values: ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] },
  { name: 'ProjectRole', values: ['LEAD', 'CONTRIBUTOR', 'REVIEWER'] },
  { name: 'ConsentPurpose', values: ['NEWSLETTER', 'PROFILING', 'THIRD_PARTY'] },
  { name: 'NotificationChannel', values: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'] },
]

const CREATED = ['DateTime @default(now())', ts(0, 500)] as FSpec

export function cleanSchema(): Schema {
  const M: Model[] = [
    // ---------------- Identity & access (8)
    model('User', 'identity', 40, {
      emailAddress: ['String @unique', email],
      displayName: ['String', fullName],
      isActive: ['Boolean @default(true)', bool(0.9)],
      lastLoginAt: ['DateTime?', ts(300, 600)],
      createdAt: CREATED,
    }),
    model('Role', 'identity', 6, {
      roleKey: ['String @unique', uniqPick(['admin', 'finance', 'sales', 'support', 'warehouse', 'auditor'])],
      title: ['String', uniqPick(['Administrator', 'Finance', 'Sales', 'Support', 'Warehouse', 'Auditor'])],
      details: ['String?', words(5)],
    }),
    model('Permission', 'identity', 20, {
      permissionKey: ['String @unique', (c) => `${['read', 'write', 'approve', 'export'][c.i % 4]}:${['invoices', 'orders', 'stock', 'tickets', 'people'][Math.floor(c.i / 4)]}`],
      details: ['String?', words(4)],
    }),
    model('RolePermission', 'identity', 40, {
      roleId: '=> Role',
      permissionId: '=> Permission',
      grantedAt: CREATED,
    }, { id: ['roleId', 'permissionId'] }),
    model('UserRole', 'identity', 50, {
      userId: '=> User',
      roleId: '=> Role',
      assignedAt: CREATED,
    }, { id: ['userId', 'roleId'] }),
    model('Session', 'identity', 50, {
      userId: '=> User',
      tokenHash: ['String @unique', hex(48)],
      ipAddress: ['String?', ipv4],
      expiresAt: ['DateTime', ts(400, 700)],
      createdAt: CREATED,
    }),
    model('ApiKey', 'identity', 15, {
      userId: '=> User',
      keyPrefix: ['String @unique', (c) => `pk_${hex(8)(c)}`],
      label: ['String', titleWords(2)],
      revokedAt: ['DateTime?', ts(300, 600), { nullRate: 0.7 }],
      createdAt: CREATED,
    }),
    model('UserCredential', 'identity', 35, {
      userId: '=> User @unique',
      passwordHash: ['String', (c) => `$argon2id$v=19$${hex(43)(c)}`],
      mfaSecret: ['String?', hex(32), { nullRate: 0.5 }],
      passwordChangedAt: ['DateTime', ts(0, 500)],
    }),

    // ---------------- Organization & HR (12)
    model('Department', 'hr', 10, {
      departmentCode: ['String @unique', seq('DEP-', 3)],
      title: ['String', uniqPick(['Finance', 'Sales', 'Support', 'Logistics', 'Engineering', 'People', 'Marketing', 'Purchasing', 'Legal', 'Facilities'])],
      parentId: ['-> Department?', undefined, { nullRate: 0.6 }],
      costCenter: ['String?', seq('CC', 4, 100)],
    }),
    model('Position', 'hr', 15, {
      positionCode: ['String @unique', seq('POS-', 3)],
      title: ['String', uniqPick(['Accountant', 'Account Executive', 'Support Agent', 'Dispatcher', 'Developer', 'Recruiter', 'Copywriter', 'Buyer', 'Counsel', 'Technician', 'Team Lead', 'Analyst', 'Controller', 'Designer', 'Coordinator'])],
      departmentId: '-> Department',
      minSalary: ['Money?', money(30000, 50000)],
      maxSalary: ['Money?', money(55000, 110000)],
    }),
    model('Employee', 'hr', 45, {
      employeeNumber: ['String @unique', seq('E', 5, 10001)],
      firstName: 'String',
      lastName: 'String',
      workEmail: ['String @unique', email],
      departmentId: '-> Department',
      positionId: '-> Position',
      managerId: ['-> Employee?', undefined, { nullRate: 0.3 }],
      userId: ['-> User? @unique', undefined, { nullRate: 0.25 }],
      hiredOn: ['Date', date(-2000, 300)],
      terminatedOn: ['Date?', after('hiredOn', 200, 900), { nullRate: 0.85 }],
      dateOfBirth: ['Date?', date(-20000, -7000)],
      emergencyContactName: ['String?', fullName],
      emergencyContactPhone: ['String?', phone],
    }),
    model('EmploymentContract', 'hr', 50, {
      employeeId: '=> Employee',
      contractType: 'ContractType',
      startsOn: ['Date', date(-1500, 300)],
      endsOn: ['Date?', after('startsOn', 180, 900), { nullRate: 0.6 }],
      weeklyHours: ['Decimal(4,1)?', pick('40.0', '38.5', '32.0', '20.0')],
      annualSalary: ['Money', money(32000, 105000)],
      signedAt: ['DateTime', ts(-1500, 300)],
    }),
    model('AbsenceType', 'hr', 6, {
      typeCode: ['String @unique', uniqPick(['VAC', 'SICK', 'PARENT', 'TRAIN', 'UNPAID', 'COMP'])],
      title: ['String', uniqPick(['Vacation', 'Sick leave', 'Parental leave', 'Training', 'Unpaid leave', 'Compensatory time'])],
      isPaid: ['Boolean', bool(0.7)],
    }),
    model('Absence', 'hr', 40, {
      employeeId: '=> Employee',
      absenceTypeId: '-> AbsenceType',
      startsOn: ['Date', date(0, 600)],
      endsOn: ['Date', after('startsOn', 0, 14)],
      approvedById: ['-> Employee?', undefined, { nullRate: 0.3 }],
      note: ['String?', sentence, { nullRate: 0.6 }],
    }),
    model('Team', 'hr', 8, {
      title: ['String', uniqPick(['Core Platform', 'Field Sales', 'Night Shift', 'Key Accounts', 'Onboarding', 'Returns Desk', 'Payroll', 'Growth'])],
      departmentId: '-> Department',
      leadId: '-> Employee?',
    }),
    model('TeamMembership', 'hr', 30, {
      teamId: '=> Team',
      employeeId: '=> Employee',
      joinedOn: ['Date', date(-400, 500)],
    }, { id: ['teamId', 'employeeId'] }),
    model('Skill', 'hr', 15, {
      title: ['String @unique', uniqPick(['Negotiation', 'Forklift licence', 'SQL', 'Bookkeeping', 'First aid', 'Spanish', 'Customs filing', 'Copy editing', 'Payroll', 'Typescript', 'Public speaking', 'Inventory audits', 'Contract law', 'Photography', 'Data analysis'])],
      details: ['String?', words(4)],
    }),
    model('EmployeeSkill', 'hr', 50, {
      employeeId: '=> Employee',
      skillId: '=> Skill',
      proficiency: ['Int', int(1, 5)],
    }, { id: ['employeeId', 'skillId'] }),
    model('PerformanceReview', 'hr', 30, {
      employeeId: '=> Employee',
      reviewerId: '-> Employee',
      reviewDate: ['Date', date(0, 600)],
      score: ['Int', int(1, 5)],
      summary: ['String?', sentence],
    }),
    model('PublicHoliday', 'hr', 12, {
      holidayDate: ['Date @unique', (c) => ['2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01', '2025-05-29', '2025-06-09', '2025-10-03', '2025-12-25', '2025-12-26', '2026-01-01', '2026-04-03', '2026-04-06'][c.i]],
      title: ['String', (c) => ["New Year's Day", 'Good Friday', 'Easter Monday', 'Labour Day', 'Ascension Day', 'Whit Monday', 'Unity Day', 'Christmas Day', 'Boxing Day', "New Year's Day", 'Good Friday', 'Easter Monday'][c.i]],
      isHalfDay: ['Boolean @default(false)', bool(0.1)],
    }),

    // ---------------- CRM (12)
    model('Industry', 'crm', 10, {
      industryCode: ['String @unique', seq('IND', 2)],
      title: ['String', uniqPick(['Retail', 'Manufacturing', 'Healthcare', 'Logistics', 'Hospitality', 'Education', 'Construction', 'Agriculture', 'Media', 'Public sector'])],
    }),
    model('Customer', 'crm', 40, {
      customerNumber: ['String @unique', seq('C-', 5, 20001)],
      companyName: ['String', company],
      billingEmail: ['String', email],
      phone: ['String?', phone],
      vatId: ['String?', (c) => `XU${String(100000000 + c.id * 7919).slice(0, 9)}`],
      industryId: '-> Industry?',
      accountManagerId: '-> Employee?',
      creditLimit: ['Money?', money(1000, 50000)],
      isActive: ['Boolean @default(true)', bool(0.85)],
      createdAt: CREATED,
    }),
    model('Contact', 'crm', 50, {
      customerId: '=> Customer',
      firstName: 'String',
      lastName: 'String',
      emailAddress: ['String?', email],
      jobTitle: ['String?', pick('Buyer', 'CFO', 'Office Manager', 'Head of Operations', 'Owner', 'Procurement Lead')],
      isPrimary: ['Boolean', bool(0.3)],
    }),
    model('ContactPhone', 'crm', 0, {
      contactId: '=> Contact',
      slot: 'Int',
      phoneNumber: 'String',
    }, { unique: [['contactId', 'slot']] }),
    model('CustomerAddress', 'crm', 50, {
      customerId: '=> Customer',
      label: ['String?', pick('HQ', 'Warehouse', 'Branch', 'Billing'), { nullRate: 0.3 }],
      street: 'String',
      postalCode: 'String',
      city: 'String',
      countryCode: ['String', (c) => ['AD', 'AL', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'][c.rng.int(0, 32)]],
      isDefaultShipping: ['Boolean', bool(0.4)],
    }),
    model('LeadSource', 'crm', 8, {
      sourceKey: ['String @unique', uniqPick(['web-form', 'trade-fair', 'referral', 'cold-call', 'webinar', 'partner', 'newsletter', 'inbound-call'])],
      title: ['String', uniqPick(['Web form', 'Trade fair', 'Referral', 'Cold call', 'Webinar', 'Partner', 'Newsletter', 'Inbound call'])],
    }),
    model('Lead', 'crm', 40, {
      fullName: ['String', fullName],
      companyName: ['String?', company],
      emailAddress: ['String?', email],
      leadSourceId: '-> LeadSource',
      status: 'LeadStatus',
      ownerId: '-> Employee?',
      createdAt: CREATED,
    }),
    model('PipelineStage', 'crm', 6, {
      title: ['String', uniqPick(['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Closed won', 'Closed lost'])],
      sortOrder: ['Int @unique', (c) => (c.i + 1) * 10],
      winProbability: ['Int', (c) => [10, 25, 50, 75, 100, 0][c.i]],
    }),
    model('Opportunity', 'crm', 30, {
      customerId: '-> Customer',
      title: ['String', titleWords(3)],
      stageId: '-> PipelineStage',
      expectedValue: ['Money', money(2000, 90000)],
      expectedCloseOn: ['Date?', date(200, 700)],
      ownerId: '-> Employee?',
      competitorId: ['-> Competitor?', undefined, { nullRate: 0.5 }],
      createdAt: CREATED,
    }),
    model('Activity', 'crm', 50, {
      activityKind: 'ActivityKind',
      subject: ['String', sentence],
      contactId: '-> Contact?',
      opportunityId: ['-> Opportunity?', undefined, { nullRate: 0.4 }],
      employeeId: '-> Employee',
      occurredAt: ['DateTime', ts(0, 600)],
    }),
    model('CrmNote', 'crm', 30, {
      customerId: '=> Customer',
      authorId: '-> Employee',
      body: ['String', sentence],
      createdAt: CREATED,
    }),
    model('Competitor', 'crm', 8, {
      companyName: ['String', company],
      websiteUrl: ['String?', url],
    }),

    // ---------------- Catalog (12)
    model('Brand', 'catalog', 10, {
      brandName: ['String @unique', uniqPick(['Northwind Tools', 'Halden', 'Oakmere', 'Brightline', 'Corvid', 'Tessellate', 'Fjordic', 'Marigold', 'Stratus', 'Kilnworks'])],
      websiteUrl: ['String?', url],
    }),
    model('Category', 'catalog', 15, {
      categorySlug: ['String @unique', uniqPick(['tools', 'garden', 'kitchen', 'lighting', 'storage', 'office', 'outdoor', 'paint', 'plumbing', 'electrical', 'hardware', 'textiles', 'cleaning', 'safety', 'seasonal'])],
      title: ['String', titleWords(1)],
      parentId: ['-> Category?', undefined, { nullRate: 0.6 }],
    }),
    model('Product', 'catalog', 40, {
      productNumber: ['String @unique', seq('P-', 5, 50001)],
      title: ['String', titleWords(2)],
      details: ['String?', words(6)],
      brandId: '-> Brand?',
      isActive: ['Boolean @default(true)', bool(0.9)],
      weightGrams: ['Int?', int(50, 25000)],
      lengthMm: ['Int?', int(20, 1200)],
      widthMm: ['Int?', int(20, 800)],
      heightMm: ['Int?', int(5, 600)],
      createdAt: CREATED,
    }),
    model('UnitOfMeasure', 'inventory', 8, {
      uomCode: ['String @unique', uniqPick(['PCS', 'BOX', 'KG', 'G', 'L', 'M', 'PAIR', 'SET'])],
      title: ['String', uniqPick(['Piece', 'Box', 'Kilogram', 'Gram', 'Litre', 'Metre', 'Pair', 'Set'])],
    }),
    model('ProductVariant', 'catalog', 50, {
      productId: '=> Product',
      sku: ['String @unique', seq('SKU-', 6, 300001)],
      variantLabel: ['String', pick('Small', 'Medium', 'Large', 'Red', 'Blue', 'Oak', 'Steel', '2-pack', '5-pack')],
      price: ['Money', money(3, 400)],
      uomId: '-> UnitOfMeasure?',
      isActive: ['Boolean @default(true)', bool(0.9)],
    }),
    model('ProductCategory', 'catalog', 50, {
      productId: '=> Product',
      categoryId: '=> Category',
    }, { id: ['productId', 'categoryId'] }),
    model('AttributeDefinition', 'catalog', 8, {
      attributeKey: ['String @unique', uniqPick(['material', 'finish', 'voltage', 'capacity', 'warranty', 'origin', 'certified', 'season'])],
      title: ['String', titleWords(1)],
      valueKind: 'AttributeKind',
    }),
    model('ProductAttributeValue', 'catalog', 50, {
      productId: '=> Product',
      attributeId: '=> AttributeDefinition',
      valueText: ['String', words(1)],
    }, { unique: [['productId', 'attributeId']] }),
    model('Tag', 'catalog', 12, {
      tagText: ['String @unique', uniqPick(['bestseller', 'eco', 'clearance', 'new', 'bundle', 'limited', 'imported', 'handmade', 'bulky', 'fragile', 'seasonal', 'premium'])],
    }),
    model('ProductTag', 'catalog', 40, {
      productId: '=> Product',
      tagId: '=> Tag',
    }, { id: ['productId', 'tagId'] }),
    model('PriceList', 'catalog', 5, {
      title: ['String', uniqPick(['Retail', 'Wholesale', 'Partner', 'Staff', 'Clearance'])],
      currencyId: '-> Currency',
      validFrom: ['Date', date(-100, 100)],
      validUntil: ['Date?', after('validFrom', 200, 500), { nullRate: 0.5 }],
    }),
    model('PriceListEntry', 'catalog', 50, {
      priceListId: '=> PriceList',
      productVariantId: '-> ProductVariant',
      unitPrice: ['Money', money(3, 400)],
    }, { unique: [['priceListId', 'productVariantId']] }),
    model('ProductImage', 'catalog', 0, {
      productId: '=> Product',
      sortOrder: 'Int',
      imageUrl: 'String',
    }, { unique: [['productId', 'sortOrder']] }),

    // ---------------- Inventory (10, incl. UnitOfMeasure above)
    model('Warehouse', 'inventory', 6, {
      warehouseCode: ['String @unique', seq('WH', 2)],
      title: ['String', (c) => `${['North', 'South', 'East', 'West', 'Central', 'Harbour'][c.i]} Depot`],
      street: 'String',
      city: 'String',
      postalCode: 'String',
    }),
    model('StorageLocation', 'inventory', 30, {
      warehouseId: '=> Warehouse',
      locationCode: ['String', (c) => `${String.fromCharCode(65 + (c.i % 6))}-${String(Math.floor(c.i / 6) + 1).padStart(2, '0')}`],
    }, { unique: [['warehouseId', 'locationCode']] }),
    model('StockLevel', 'inventory', 50, {
      productVariantId: '-> ProductVariant',
      storageLocationId: '=> StorageLocation',
      quantityOnHand: ['Int', int(0, 500)],
      quantityReserved: ['Int', int(0, 40)],
    }, { unique: [['productVariantId', 'storageLocationId']] }),
    model('StockMovement', 'inventory', 50, {
      productVariantId: '-> ProductVariant',
      fromLocationId: ['-> StorageLocation?', undefined, { nullRate: 0.3 }],
      toLocationId: ['-> StorageLocation?', undefined, { nullRate: 0.3 }],
      movementKind: 'MovementKind',
      quantity: ['Int', int(1, 120)],
      movedAt: ['DateTime', ts(0, 600)],
    }),
    model('Stocktake', 'inventory', 8, {
      warehouseId: '-> Warehouse',
      countedOn: ['Date', date(0, 600)],
      status: 'StocktakeStatus',
    }),
    model('StocktakeLine', 'inventory', 50, {
      stocktakeId: '=> Stocktake',
      productVariantId: '-> ProductVariant',
      expectedQuantity: ['Int', int(0, 300)],
      countedQuantity: ['Int', int(0, 300)],
    }),
    model('Supplier', 'inventory', 15, {
      supplierCode: ['String @unique', seq('SUP-', 4)],
      companyName: ['String', company],
      contactEmail: ['String', email],
      phone: ['String?', phone],
      paymentTermId: '-> PaymentTerm?',
      websiteUrl: ['String?', url],
      ratingScore: ['Int?', int(1, 5)],
      isActive: ['Boolean @default(true)', bool(0.9)],
      createdAt: CREATED,
    }),
    model('PurchaseOrder', 'inventory', 25, {
      purchaseOrderNumber: ['String @unique', seq('PO-', 6, 400001)],
      supplierId: '-> Supplier',
      warehouseId: '-> Warehouse',
      status: 'PurchaseOrderStatus',
      orderedAt: ['DateTime', ts(0, 600)],
      expectedOn: ['Date?', date(10, 650)],
    }),
    model('PurchaseOrderLine', 'inventory', 50, {
      purchaseOrderId: '=> PurchaseOrder',
      productVariantId: '-> ProductVariant',
      orderedQuantity: ['String', pick('2 kg', '500g', '1.5', '12', '3 pcs', '250 g', '0.75 kg', '40', '1 box')],
      unitCost: ['Money', money(1, 250)],
    }),

    // ---------------- Sales (10)
    model('SalesChannel', 'sales', 5, {
      channelKey: ['String @unique', uniqPick(['webshop', 'marketplace', 'phone', 'field', 'showroom'])],
      title: ['String', uniqPick(['Web shop', 'Marketplace', 'Phone orders', 'Field sales', 'Showroom'])],
    }),
    model('Cart', 'sales', 25, {
      customerId: '-> Customer?',
      salesChannelId: '-> SalesChannel',
      createdAt: CREATED,
      updatedAt: ['DateTime @updatedAt', ts(500, 600)],
    }),
    model('CartItem', 'sales', 50, {
      cartId: '=> Cart',
      productVariantId: '-> ProductVariant',
      quantity: ['Int', int(1, 6)],
      addedAt: ['DateTime', ts(400, 600)],
    }),
    model('SalesOrder', 'sales', 40, {
      orderReference: ['String @unique', seq('SO-', 6, 700001)],
      customerId: '-> Customer',
      salesChannelId: '-> SalesChannel',
      status: 'OrderStatus',
      placedAt: ['DateTime', ts(0, 600)],
      currencyId: '-> Currency',
      shippingAddressId: '-> CustomerAddress?',
    }),
    model('OrderItem', 'sales', 50, {
      salesOrderId: '=> SalesOrder',
      productVariantId: '-> ProductVariant',
      quantity: ['Int', int(1, 8)],
      unitPrice: ['Money', undefined, SNAP('variant price at the time the order was placed')],
    }),
    model('Discount', 'sales', 10, {
      discountCode: ['String @unique', (c) => `${String(words(1)(c)).toUpperCase()}${10 + c.i * 5}`],
      percentOff: ['Decimal(5,2)?', pick('5.00', '10.00', '15.00', '20.00')],
      amountOff: ['Money?', money(5, 50), { nullRate: 0.6 }],
      validFrom: ['Date', date(0, 400)],
      validUntil: ['Date?', after('validFrom', 30, 120)],
    }),
    model('DiscountRedemption', 'sales', 20, {
      discountId: '-> Discount',
      salesOrderId: '=> SalesOrder',
      amountApplied: ['Money', money(2, 60)],
      redeemedAt: ['DateTime', ts(0, 600)],
    }),
    model('ReturnRequest', 'sales', 12, {
      returnReference: ['String @unique', seq('RMA-', 5, 1001)],
      salesOrderId: '-> SalesOrder',
      status: 'ReturnStatus',
      requestedAt: ['DateTime', ts(100, 600)],
    }),
    model('ReturnItem', 'sales', 20, {
      returnRequestId: '=> ReturnRequest',
      orderItemId: '-> OrderItem',
      quantity: ['Int', int(1, 3)],
      conditionNote: ['String?', pick('Unopened', 'Damaged in transit', 'Wrong size', 'Changed mind'), { nullRate: 0.4 }],
    }),
    model('OrderStatusChange', 'sales', 50, {
      salesOrderId: '=> SalesOrder',
      fromStatus: ['OrderStatus?', undefined, { nullRate: 0.2 }],
      toStatus: 'OrderStatus',
      changedAt: ['DateTime', ts(0, 600)],
    }),

    // ---------------- Billing (10)
    model('Currency', 'billing', 8, {
      isoCode: ['String @unique', uniqPick(['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN'])],
      title: ['String', uniqPick(['Euro', 'Pound sterling', 'US dollar', 'Swiss franc', 'Swedish krona', 'Norwegian krone', 'Danish krone', 'Polish zloty'])],
      minorUnits: ['Int', fixed(2)],
      createdAt: ['DateTime @default(now())', fixed('2024-01-02 09:00:00')],
    }),
    model('TaxRate', 'billing', 6, {
      taxCode: ['String @unique', uniqPick(['STD', 'RED', 'ZERO', 'EXEMPT', 'SUPER', 'IMPORT'])],
      title: ['String', uniqPick(['Standard', 'Reduced', 'Zero rated', 'Exempt', 'Super reduced', 'Import'])],
      ratePercent: ['Decimal(5,2)', (c) => ['20.00', '7.00', '0.00', '0.00', '2.10', '19.00'][c.i]],
      validFrom: ['Date', fixed('2024-01-01')],
    }),
    model('PaymentTerm', 'billing', 5, {
      termCode: ['String @unique', uniqPick(['NET14', 'NET30', 'NET45', 'NET60', 'PREPAY'])],
      title: ['String', uniqPick(['14 days net', '30 days net', '45 days net', '60 days net', 'Prepayment'])],
      netDays: ['Int', (c) => [14, 30, 45, 60, 0][c.i]],
    }),
    model('BillingAccount', 'billing', 30, {
      accountReference: ['String @unique', seq('BA-', 5, 9001)],
      customerId: '-> Customer',
      paymentTermId: '-> PaymentTerm',
      invoiceEmail: ['String', email],
    }),
    model('Invoice', 'billing', 35, {
      invoiceNumber: ['String @unique', seq('INV-2025-', 5, 1)],
      billingAccountId: '-> BillingAccount',
      salesOrderId: ['-> SalesOrder?', undefined, { nullRate: 0.3 }],
      currencyId: '-> Currency',
      status: 'InvoiceStatus',
      issuedOn: ['Date', date(0, 600)],
      dueOn: ['Date', after('issuedOn', 14, 60)],
      billingName: ['String', undefined, SNAP('customer name when the invoice was issued')],
      billingStreet: ['String', undefined, SNAP('billing address when the invoice was issued')],
      billingPostalCode: ['String', undefined, SNAP('billing address when the invoice was issued')],
      billingCity: ['String', undefined, SNAP('billing address when the invoice was issued')],
      totalNet: ['Money', undefined, SNAP('invoice totals as issued; legally fixed')],
      totalTax: ['Money', undefined, SNAP('invoice totals as issued; legally fixed')],
      totalGross: ['Money', undefined, SNAP('invoice totals as issued; legally fixed')],
    }),
    model('InvoiceLine', 'billing', 50, {
      invoiceId: '=> Invoice',
      lineText: ['String', titleWords(3)],
      quantity: ['Int', int(1, 10)],
      unitPrice: ['Money', money(3, 400)],
      taxRateId: '-> TaxRate',
    }),
    model('CreditNote', 'billing', 10, {
      creditNoteNumber: ['String @unique', seq('CN-2025-', 4, 1)],
      invoiceId: '-> Invoice',
      issuedOn: ['Date', date(100, 600)],
      memo: ['String?', sentence],
    }),
    model('CreditNoteLine', 'billing', 20, {
      creditNoteId: '=> CreditNote',
      lineText: ['String', titleWords(3)],
      amount: ['Money', money(5, 300)],
    }),
    model('DunningLevel', 'billing', 5, {
      levelNumber: ['Int @unique', (c) => c.i + 1],
      title: ['String', (c) => ['Friendly reminder', 'Second notice', 'Final demand', 'Collection notice', 'Legal referral'][c.i]],
      feeAmount: ['Money', (c) => ['0.00', '5.00', '15.00', '25.00', '40.00'][c.i]],
      daysOverdue: ['Int', (c) => [7, 21, 42, 63, 90][c.i]],
    }),
    model('DunningNotice', 'billing', 15, {
      invoiceId: '-> Invoice',
      dunningLevelId: '-> DunningLevel',
      sentAt: ['DateTime', ts(100, 600)],
    }),

    // ---------------- Payments (6)
    model('PaymentProvider', 'payments', 5, {
      providerKey: ['String @unique', uniqPick(['cardhub', 'sepa-direct', 'bankwire', 'walletly', 'paylater'])],
      title: ['String', uniqPick(['CardHub', 'SEPA Direct', 'Bank wire', 'Walletly', 'PayLater'])],
    }),
    model('PaymentMethod', 'payments', 30, {
      billingAccountId: '=> BillingAccount',
      paymentProviderId: '-> PaymentProvider',
      methodKind: 'PaymentMethodKind',
      maskedReference: ['String', (c) => `**** ${String(c.rng.int(0, 9999)).padStart(4, '0')}`],
      isDefault: ['Boolean', bool(0.5)],
    }),
    model('Payment', 'payments', 40, {
      paymentReference: ['String @unique', seq('PAY-', 7, 1000001)],
      billingAccountId: '-> BillingAccount',
      paymentMethodId: '-> PaymentMethod?',
      amount: ['Money', money(10, 5000)],
      currencyId: '-> Currency',
      status: 'PaymentStatus',
      receivedAt: ['DateTime', ts(0, 600)],
    }),
    model('PaymentAllocation', 'payments', 40, {
      paymentId: '=> Payment',
      invoiceId: '-> Invoice',
      allocatedAmount: ['Money', money(10, 3000)],
    }, { unique: [['paymentId', 'invoiceId']] }),
    model('Refund', 'payments', 10, {
      paymentId: '-> Payment',
      amount: ['Money', money(5, 500)],
      refundNote: ['String?', sentence],
      refundedAt: ['DateTime', ts(100, 600)],
    }),
    model('Payout', 'payments', 12, {
      payoutReference: ['String @unique', seq('PO-X-', 5, 1)],
      paymentProviderId: '-> PaymentProvider',
      amount: ['Money', money(500, 40000)],
      currencyId: '-> Currency',
      paidOutAt: ['DateTime', ts(0, 600)],
    }),

    // ---------------- Logistics (8)
    model('Carrier', 'logistics', 6, {
      carrierCode: ['String', uniqPick(['PKX', 'SWF', 'NRL', 'BLU', 'TRK', 'EXL'])],
      title: ['String', uniqPick(['Parcelix', 'Swiftfreight', 'Northrail Logistics', 'Bluebox Couriers', 'Trackline', 'Expresslane'])],
      trackingUrlTemplate: ['String?', (c) => `https://track-${c.id}.example.test/{code}`],
    }, { index: [['carrierCode']] }),
    model('CarrierService', 'logistics', 12, {
      carrierId: '=> Carrier',
      serviceCode: ['String', (c) => ['STD', 'EXP', 'ECO', 'NXT'][c.i % 4] + String(Math.floor(c.i / 4) + 1)],
      title: ['String', pick('Standard', 'Express', 'Economy', 'Next day')],
    }, { unique: [['carrierId', 'serviceCode']] }),
    model('ShippingZone', 'logistics', 5, {
      zoneCode: ['String @unique', uniqPick(['DOM', 'EU1', 'EU2', 'EEA', 'WORLD'])],
      title: ['String', uniqPick(['Domestic', 'EU core', 'EU outer', 'EEA', 'Rest of world'])],
    }),
    model('ShippingRate', 'logistics', 30, {
      shippingZoneId: '=> ShippingZone',
      carrierServiceId: '-> CarrierService',
      maxWeightGrams: ['Int', pick(1000, 2000, 5000, 10000, 31500)],
      price: ['Decimal(10,2)', (c) => (c.rng.int(8, 160) * 0.25 + 0.99).toFixed(2)],
    }),
    model('Shipment', 'logistics', 35, {
      salesOrderId: '-> SalesOrder',
      carrierServiceId: '-> CarrierService',
      customerAddressId: '-> CustomerAddress',
      trackingCode: ['String?', (c) => `TRK${String(hex(10)(c)).toUpperCase()}`],
      shippedAt: ['DateTime?', ts(0, 600)],
      shipToName: ['String', undefined, SNAP('recipient as printed on the label at dispatch')],
      shipToStreet: ['String', undefined, SNAP('delivery address at dispatch')],
      shipToPostalCode: ['String', undefined, SNAP('delivery address at dispatch')],
      shipToCity: ['String', undefined, SNAP('delivery address at dispatch')],
    }),
    model('Parcel', 'logistics', 45, {
      shipmentId: '=> Shipment',
      weightGrams: ['Int', int(100, 30000)],
      parcelLabel: ['String?', (c) => `${c.id}/${c.rng.int(1, 3)}`],
    }),
    model('TrackingEvent', 'logistics', 50, {
      parcelId: '=> Parcel',
      carrierId: '-> Carrier',
      eventKind: 'TrackingEventKind',
      occurredAt: ['DateTime', ts(0, 600)],
      locationText: ['String?', (c) => `Hub ${c.rng.int(1, 30)}`],
    }),
    model('DeliveryAttempt', 'logistics', 20, {
      shipmentId: '=> Shipment',
      attemptedAt: ['DateTime', ts(0, 600)],
      succeeded: ['Boolean', bool(0.7)],
      failureNote: ['String?', pick('Recipient absent', 'Address not found', 'Refused'), { nullRate: 0.6 }],
    }),

    // ---------------- Support (8)
    model('SupportQueue', 'support', 5, {
      queueKey: ['String @unique', uniqPick(['general', 'billing', 'returns', 'technical', 'vip'])],
      title: ['String', uniqPick(['General', 'Billing questions', 'Returns', 'Technical', 'VIP'])],
    }),
    model('SlaPolicy', 'support', 5, {
      title: ['String', uniqPick(['Basic', 'Business', 'Premium', 'Critical', 'Partner'])],
      firstResponseMinutes: ['Int', (c) => [1440, 480, 120, 30, 240][c.i]],
      resolutionMinutes: ['Int', (c) => [10080, 2880, 1440, 240, 2880][c.i]],
    }),
    model('TicketCategory', 'support', 8, {
      title: ['String @unique', uniqPick(['Delivery', 'Invoice', 'Product defect', 'Account', 'Refund', 'Warranty', 'Order change', 'Other'])],
      parentId: ['-> TicketCategory?', undefined, { nullRate: 0.7 }],
    }),
    model('TicketLabel', 'support', 10, {
      labelText: ['String @unique', uniqPick(['urgent', 'callback', 'vip', 'duplicate', 'bug', 'billing', 'feedback', 'escalated', 'legal', 'follow-up'])],
      colorHex: ['String', (c) => `#${hex(6)(c)}`],
      createdById: '-> User?',
    }),
    model('Ticket', 'support', 40, {
      ticketReference: ['String @unique', seq('T-', 6, 100001)],
      subject: ['String', sentence],
      customerId: '-> Customer?',
      queueId: '-> SupportQueue',
      categoryId: '-> TicketCategory?',
      slaPolicyId: '-> SlaPolicy?',
      assigneeId: '-> Employee?',
      status: 'TicketStatus',
      createdAt: CREATED,
      resolvedAt: ['DateTime?', ts(500, 650), { nullRate: 0.5 }],
    }),
    model('TicketMessage', 'support', 50, {
      ticketId: '=> Ticket',
      authorEmployeeId: '-> Employee?',
      body: ['String', sentence],
      isInternal: ['Boolean', bool(0.2)],
      sentAt: ['DateTime', ts(0, 600)],
    }),
    model('TicketLabelAssignment', 'support', 0, {
      ticketId: '=> Ticket',
      labelId: '=> TicketLabel',
    }, { id: ['ticketId', 'labelId'] }),
    model('CannedResponse', 'support', 12, {
      queueId: '-> SupportQueue',
      title: ['String', titleWords(2)],
      responseBody: ['String', sentence],
      isActive: ['Boolean @default(true)', bool(0.8)],
    }),

    // ---------------- Projects (8)
    model('ProjectTemplate', 'projects', 5, {
      title: ['String @unique', uniqPick(['Implementation', 'Warehouse move', 'Audit prep', 'Product launch', 'Office fit-out'])],
      details: ['String?', words(5)],
    }),
    model('Project', 'projects', 15, {
      projectCode: ['String @unique', seq('PRJ-', 3)],
      title: ['String', titleWords(2)],
      customerId: '-> Customer?',
      templateId: ['-> ProjectTemplate?', undefined, { nullRate: 0.4 }],
      startsOn: ['Date', date(0, 400)],
      endsOn: ['Date?', after('startsOn', 60, 300)],
      budget: ['Money?', money(5000, 120000)],
    }),
    model('Milestone', 'projects', 0, {
      projectId: '=> Project',
      title: 'String',
      dueOn: 'Date',
      completedAt: 'DateTime?',
    }),
    model('ProjectMember', 'projects', 40, {
      projectId: '=> Project',
      employeeId: '=> Employee',
      projectRole: 'ProjectRole',
    }, { id: ['projectId', 'employeeId'] }),
    model('Task', 'projects', 50, {
      projectId: '=> Project',
      title: ['String', titleWords(3)],
      details: ['String?', sentence],
      assigneeId: '-> Employee?',
      dueOn: ['Date?', date(100, 700)],
      isDone: ['Boolean', bool(0.4)],
      createdAt: CREATED,
    }),
    model('TaskDependency', 'projects', 20, {
      taskId: '=> Task',
      dependsOnTaskId: '=> Task',
    }, { id: ['taskId', 'dependsOnTaskId'] }),
    model('TaskComment', 'projects', 40, {
      taskId: '=> Task',
      authorId: '-> Employee',
      body: ['String', sentence],
      createdAt: CREATED,
    }),
    model('TimeEntry', 'projects', 50, {
      taskId: '-> Task',
      employeeId: '-> Employee',
      workDate: ['Date', date(0, 600)],
      minutes: ['Int', (c) => c.rng.int(1, 16) * 30],
      note: ['String?', sentence, { nullRate: 0.6 }],
    }),

    // ---------------- Marketing (8)
    model('Segment', 'marketing', 8, {
      title: ['String', uniqPick(['Big spenders', 'Dormant', 'New this year', 'Trade', 'Northern region', 'Garden lovers', 'Repeat buyers', 'Newsletter fans'])],
      details: ['String?', words(5)],
      createdById: '-> User',
    }),
    model('SegmentMembership', 'marketing', 50, {
      segmentId: '=> Segment',
      customerId: '=> Customer',
      addedAt: CREATED,
    }, { id: ['segmentId', 'customerId'] }),
    model('Campaign', 'marketing', 12, {
      title: ['String', titleWords(2)],
      startsOn: ['Date', date(0, 500)],
      endsOn: ['Date?', after('startsOn', 14, 60)],
      budget: ['Money?', money(500, 25000)],
      ownerId: '-> Employee?',
      emailTemplateId: '-> EmailTemplate?',
    }),
    model('CampaignSegment', 'marketing', 0, {
      campaignId: '=> Campaign',
      segmentId: '=> Segment',
    }, { id: ['campaignId', 'segmentId'] }),
    model('EmailTemplate', 'marketing', 10, {
      templateKey: ['String @unique', (c) => `mkt-${words(1)(c)}-${c.id}`],
      title: ['String', titleWords(2)],
      subject: ['String', sentence],
      bodyHtml: ['String', (c) => `<p>${sentence(c)}</p>`],
      isActive: ['Boolean @default(true)', bool(0.8)],
      createdAt: CREATED,
      createdById: '-> User',
    }),
    model('Newsletter', 'marketing', 5, {
      title: ['String', uniqPick(['Monthly digest', 'Trade insider', 'Garden notes', 'Product news', 'Workshop dates'])],
      details: ['String?', words(5)],
      isActive: ['Boolean @default(true)', bool(0.9)],
      createdAt: CREATED,
    }),
    model('NewsletterSubscription', 'marketing', 50, {
      newsletterId: '=> Newsletter',
      contactId: '=> Contact',
      subscribedAt: ['DateTime', ts(0, 500)],
      unsubscribedAt: ['DateTime?', ts(500, 650), { nullRate: 0.8 }],
      doubleOptIn: ['Boolean', bool(0.6)],
    }),
    model('MarketingConsent', 'marketing', 40, {
      contactId: '=> Contact',
      consentPurpose: 'ConsentPurpose',
      grantedAt: ['DateTime', ts(0, 500)],
      revokedAt: ['DateTime?', ts(500, 650), { nullRate: 0.8 }],
    }),

    // ---------------- Documents (4)
    model('Folder', 'documents', 10, {
      title: ['String', titleWords(1)],
      parentId: ['-> Folder?', undefined, { nullRate: 0.5 }],
      ownerId: '-> User',
    }),
    model('Document', 'documents', 25, {
      folderId: '-> Folder',
      title: ['String', titleWords(3)],
      createdById: '-> User',
      createdAt: CREATED,
      archivedAt: ['DateTime?', ts(400, 650), { nullRate: 0.8 }],
    }),
    model('DocumentVersion', 'documents', 40, {
      documentId: '=> Document',
      revision: ['Int', (c) => c.i + 1],
      storageKey: ['String @unique', (c) => `docs/${hex(16)(c)}`],
      byteSize: ['Int', int(2000, 9000000)],
      checksumSha256: ['String', hex(64)],
      uploadedById: '-> User',
      uploadedAt: ['DateTime', ts(0, 600)],
    }, { unique: [['documentId', 'revision']] }),
    model('DocumentShare', 'documents', 20, {
      documentId: '=> Document',
      sharedWithUserId: '-> User',
      canEdit: ['Boolean', bool(0.3)],
      sharedAt: ['DateTime', ts(0, 600)],
    }, { unique: [['documentId', 'sharedWithUserId']] }),

    // ---------------- Audit, notifications, settings (6)
    model('AuditEvent', 'audit', 50, {
      actorUserId: '-> User?',
      eventKey: ['String', (c) => `${['invoice', 'order', 'ticket', 'customer', 'stock', 'user', 'payment'][c.rng.int(0, 6)]}.${['created', 'updated', 'deleted', 'approved', 'exported'][c.rng.int(0, 4)]}`],
      payload: ['Json'],
      occurredAt: ['DateTime', ts(0, 650)],
    }),
    model('NotificationTemplate', 'audit', 8, {
      templateKey: ['String @unique', (c) => `ntf-${words(1)(c)}-${c.id}`],
      title: ['String', titleWords(2)],
      subject: ['String', sentence],
      bodyText: ['String', sentence],
      isActive: ['Boolean @default(true)', bool(0.8)],
      createdAt: CREATED,
      channel: 'NotificationChannel',
    }),
    model('Notification', 'audit', 50, {
      userId: '=> User',
      templateId: '-> NotificationTemplate?',
      title: ['String', sentence],
      readAt: ['DateTime?', ts(300, 650), { nullRate: 0.5 }],
      createdAt: CREATED,
    }),
    model('NotificationPreference', 'audit', 40, {
      userId: '=> User',
      channel: 'NotificationChannel',
      isEnabled: ['Boolean', bool(0.7)],
    }, { unique: [['userId', 'channel']] }),
    model('AppSetting', 'audit', 8, {
      settingKey: ['String @unique', uniqPick(['invoice.numbering', 'shop.checkout', 'support.hours', 'stock.alerts', 'mail.smtp', 'tax.defaults', 'ui.theme', 'export.schedule'])],
      configData: ['Json'],
      updatedAt: ['DateTime @updatedAt', ts(300, 650)],
      updatedById: '-> User?',
    }),
    model('Webhook', 'audit', 6, {
      targetUrl: ['String', (c) => `https://hooks-${c.id}.example.test/inbound`],
      secretHash: ['String', hex(64)],
      isActive: ['Boolean @default(true)', bool(0.8)],
      createdById: '-> User',
    }),
  ]
  return { models: M, enums: structuredClone(ENUMS) }
}
