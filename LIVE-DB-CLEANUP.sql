-- LIVE DATABASE CLEANUP - Run this in Supabase SQL Editor BEFORE applying FINAL-DATABASE-FIX.sql
-- This fixes the "profiles_phone_key" duplicate constraint violation that blocks new signups

-- Step 1: Remove or normalize duplicate phone entries that are empty strings
-- Empty-string phones can cause unique constraint violations
UPDATE public.profiles 
SET phone = NULL 
WHERE phone = '';

-- Step 2: Verify the cleanup
SELECT 'Cleaned up empty-string phones. Current phone values:' as status;
SELECT phone, COUNT(*) as count FROM public.profiles GROUP BY phone;
