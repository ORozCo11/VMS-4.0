<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Support\Facades\Storage;

trait UploadsImages
{
    private function storeUploadedImage($file, string $directory): string
    {
        $filename = uniqid(rtrim($directory, '-') . '_', true) . '.' . $file->getClientOriginalExtension();

        try {
            $path = Storage::disk('supabase')->putFileAs($directory, $file, $filename, 'public');

            return $this->publicStorageUrl($path);
        } catch (\Throwable $throwable) {
            // Don't fail the request, but make the fallback visible — a silent
            // fallback previously hid broken Supabase credentials for a long time.
            \Illuminate\Support\Facades\Log::warning(
                "Supabase upload failed for {$directory}/{$filename}; stored locally instead. ({$throwable->getMessage()})"
            );
            $path = Storage::disk('public')->putFileAs($directory, $file, $filename, 'public');

            return $this->publicLocalStorageUrl($path);
        }
    }

    private function publicStorageUrl(string $path): string
    {
        $baseUrl = rtrim((string) config('filesystems.disks.supabase.url'), '/');

        return $baseUrl === '' ? $path : $baseUrl . '/' . ltrim($path, '/');
    }

    private function publicLocalStorageUrl(string $path): string
    {
        $baseUrl = rtrim((string) config('app.url'), '/');

        return $baseUrl . '/storage/' . ltrim($path, '/');
    }
}
