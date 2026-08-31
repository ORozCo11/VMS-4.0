<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class RegistrationSetting extends Model
{
    protected $fillable = ['barangay_id', 'staff_code'];

    /**
     * One row per barangay. Fetch it (lazily creating one with a fresh code
     * the first time it's needed — e.g. the moment that barangay's brand
     * new Admin first opens the Users module) instead of every caller
     * having to know that.
     */
    public static function for(int $barangayId): self
    {
        return static::firstOrCreate(
            ['barangay_id' => $barangayId],
            ['staff_code' => static::generateCode()]
        );
    }

    public static function regenerateFor(int $barangayId): self
    {
        $setting = static::for($barangayId);
        $setting->update(['staff_code' => static::generateCode()]);
        return $setting;
    }

    private static function generateCode(): string
    {
        return Str::upper(Str::random(8));
    }
}
