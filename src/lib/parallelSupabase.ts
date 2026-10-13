// Supabase integration for Mthunzi Parallel
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  ParallelBusiness,
  ParallelBranch,
  DashboardUser,
  UploadedFile,
  ParallelReport,
  ProcessingLog,
} from '@/types/pos';

// ========== PARALLEL BUSINESSES ==========

export async function createParallelBusiness(business: Omit<ParallelBusiness, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParallelBusiness | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('parallel_businesses')
    .insert([{
      name: business.name,
      owner_name: business.ownerName,
      owner_phone: business.ownerPhone,
      owner_email: business.ownerEmail,
      address: business.address,
      industry: business.industry,
      logo_url: business.logoUrl,
      currency: business.currency,
      currency_symbol: business.currencySymbol,
      admin_user_id: business.adminUserId,
      is_active: business.isActive,
    }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create business:', error);
    return null;
  }

  return data as ParallelBusiness;
}

export async function getParallelBusinesses(): Promise<ParallelBusiness[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('parallel_businesses')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch businesses:', error);
    return [];
  }

  return (data || []) as ParallelBusiness[];
}

export async function getParallelBusiness(id: string): Promise<ParallelBusiness | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('parallel_businesses')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Failed to fetch business:', error);
    return null;
  }

  return data as ParallelBusiness;
}

export async function updateParallelBusiness(id: string, updates: Partial<ParallelBusiness>): Promise<ParallelBusiness | null> {
  if (!isSupabaseConfigured()) return null;

  const updateData: Record<string, any> = {};
  if (updates.name) updateData.name = updates.name;
  if (updates.logoUrl) updateData.logo_url = updates.logoUrl;
  if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

  const { data, error } = await supabase
    .from('parallel_businesses')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update business:', error);
    return null;
  }

  return data as ParallelBusiness;
}

// ========== PARALLEL BRANCHES ==========

export async function createParallelBranch(branch: Omit<ParallelBranch, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParallelBranch | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('parallel_branches')
    .insert([{
      business_id: branch.businessId,
      name: branch.name,
      location: branch.location,
      manager_name: branch.managerName,
      manager_phone: branch.managerPhone,
      is_active: branch.isActive,
    }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create branch:', error);
    return null;
  }

  return data as ParallelBranch;
}

export async function getBranchesByBusiness(businessId: string): Promise<ParallelBranch[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('parallel_branches')
    .select('*')
    .eq('business_id', businessId)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to fetch branches:', error);
    return [];
  }

  return (data || []) as ParallelBranch[];
}

// ========== DASHBOARD USERS ==========

export async function createDashboardUser(user: Omit<DashboardUser, 'id' | 'createdAt' | 'updatedAt'>): Promise<DashboardUser | null> {
  if (!isSupabaseConfigured()) return null;

  // Hash password (simple implementation - use bcrypt in production)
  const passwordHash = user.password ? btoa(user.password) : undefined;

  const { data, error } = await supabase
    .from('dashboard_users')
    .insert([{
      business_id: user.businessId,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      password_hash: passwordHash,
      is_active: user.isActive,
    }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create dashboard user:', error);
    return null;
  }

  return data as DashboardUser;
}

export async function getDashboardUsersByBusiness(businessId: string): Promise<DashboardUser[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('dashboard_users')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch dashboard users:', error);
    return [];
  }

  return (data || []) as DashboardUser[];
}

// ========== UPLOADED FILES ==========

export async function uploadFile(file: File, businessId: string, branchId: string, uploadedBy: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const fileName = `parallel/${businessId}/${branchId}/${Date.now()}_${file.name}`;

  const { data, error } = await supabase.storage
    .from('pos-files')
    .upload(fileName, file);

  if (error) {
    console.error('Failed to upload file:', error);
    return null;
  }

  return data.path;
}

export async function createUploadedFile(fileData: Omit<UploadedFile, 'id' | 'createdAt' | 'updatedAt'>): Promise<UploadedFile | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('uploaded_files')
    .insert([{
      business_id: fileData.businessId,
      branch_id: fileData.branchId,
      file_name: fileData.fileName,
      file_format: fileData.fileFormat,
      file_size: fileData.fileSize,
      file_url: fileData.fileUrl,
      uploaded_by: fileData.uploadedBy,
      process_status: fileData.processStatus,
      error_message: fileData.errorMessage,
      processed_data: fileData.processedData,
    }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create uploaded file record:', error);
    return null;
  }

  return data as UploadedFile;
}

export async function getUploadedFilesByBranch(branchId: string): Promise<UploadedFile[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('uploaded_files')
    .select('*')
    .eq('branch_id', branchId)
    .order('uploaded_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch uploaded files:', error);
    return [];
  }

  return (data || []) as UploadedFile[];
}

export async function updateUploadedFile(id: string, updates: Partial<UploadedFile>): Promise<UploadedFile | null> {
  if (!isSupabaseConfigured()) return null;

  const updateData: Record<string, any> = {};
  if (updates.processStatus) updateData.process_status = updates.processStatus;
  if (updates.errorMessage) updateData.error_message = updates.errorMessage;
  if (updates.processedData) updateData.processed_data = updates.processedData;
  if (updates.processedAt) updateData.processed_at = updates.processedAt;

  const { data, error } = await supabase
    .from('uploaded_files')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update uploaded file:', error);
    return null;
  }

  return data as UploadedFile;
}

// ========== PARALLEL REPORTS ==========

export async function createParallelReport(report: Omit<ParallelReport, 'id' | 'createdAt' | 'updatedAt'>): Promise<ParallelReport | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('parallel_reports')
    .insert([{
      business_id: report.businessId,
      branch_id: report.branchId,
      report_date: report.reportDate,
      report_type: report.reportType,
      uploaded_file_ids: report.uploadedFileIds,
      extracted_from: report.extractedFrom,
      opening_stock_items: report.openingStockItems,
      opening_stock_value: report.openingStockValue,
      closing_stock_items: report.closingStockItems,
      closing_stock_value: report.closingStockValue,
      products_sold: report.productsSold,
      quantity_sold: report.quantitySold,
      sales_value: report.salesValue,
      gross_profit: report.grossProfit,
      gross_profit_margin: report.grossProfitMargin,
      inventory_accuracy: report.inventoryAccuracy,
      missing_products: report.missingProducts,
      extra_products: report.extraProducts,
      low_stock_products: report.lowStockProducts,
      out_of_stock_products: report.outOfStockProducts,
      stock_variance: report.stockVariance,
      top_selling_products: report.topSellingProducts,
      recommendations: report.recommendations,
      status: report.status,
      prepared_by: report.preparedBy,
    }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create report:', error);
    return null;
  }

  return data as ParallelReport;
}

export async function getReportsByBranch(branchId: string, limit: number = 50): Promise<ParallelReport[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('parallel_reports')
    .select('*')
    .eq('branch_id', branchId)
    .order('report_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to fetch reports:', error);
    return [];
  }

  return (data || []) as ParallelReport[];
}

export async function getApprovedReportsByBranch(branchId: string): Promise<ParallelReport[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('parallel_reports')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'approved')
    .order('report_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch approved reports:', error);
    return [];
  }

  return (data || []) as ParallelReport[];
}

export async function getLatestApprovedReport(branchId: string): Promise<ParallelReport | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('parallel_reports')
    .select('*')
    .eq('branch_id', branchId)
    .eq('status', 'approved')
    .order('report_date', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Failed to fetch latest approved report:', error);
  }

  return data as ParallelReport | null;
}

export async function updateParallelReport(id: string, updates: Partial<ParallelReport>): Promise<ParallelReport | null> {
  if (!isSupabaseConfigured()) return null;

  const updateData: Record<string, any> = {};
  if (updates.status) updateData.status = updates.status;
  if (updates.approvedBy) updateData.approved_by = updates.approvedBy;
  if (updates.approvedAt) updateData.approved_at = updates.approvedAt;
  if (updates.rejectionReason) updateData.rejection_reason = updates.rejectionReason;
  if (updates.reportUrl) updateData.report_url = updates.reportUrl;
  if (updates.sharedViaWhatsApp !== undefined) updateData.shared_via_whatsapp = updates.sharedViaWhatsApp;
  if (updates.sharedAt) updateData.shared_at = updates.sharedAt;
  if (updates.sharedWith) updateData.shared_with = updates.sharedWith;

  const { data, error } = await supabase
    .from('parallel_reports')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update report:', error);
    return null;
  }

  return data as ParallelReport;
}

// ========== PROCESSING LOGS ==========

export async function createProcessingLog(log: Omit<ProcessingLog, 'id' | 'createdAt'>): Promise<ProcessingLog | null> {
  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase
    .from('processing_logs')
    .insert([{
      uploaded_file_id: log.uploadedFileId,
      report_id: log.reportId,
      log_level: log.level,
      message: log.message,
      details: log.details,
      processed_at: log.processedAt,
    }])
    .select()
    .single();

  if (error) {
    console.error('Failed to create processing log:', error);
    return null;
  }

  return data as ProcessingLog;
}

export async function getProcessingLogsByFile(fileId: string): Promise<ProcessingLog[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await supabase
    .from('processing_logs')
    .select('*')
    .eq('uploaded_file_id', fileId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch processing logs:', error);
    return [];
  }

  return (data || []) as ProcessingLog[];
}
