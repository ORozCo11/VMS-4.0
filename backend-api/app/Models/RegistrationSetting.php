<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class RegistrationSetting extends Model
{
    protected $fillable = ['staff_code'];

    /**
     * There's only ever one row. Fetch it (creating one with a fresh code
     * if, somehow, none exists yet) instead of every caller having to
     * know that.
     */
    public static function current(): self
    {
        return static::first() ?? static::create(['staff_code' => static::generateCode()]);
    }

    public static function regenerate(): self
    {
        $setting = static::current();
        $setting->update(['staff_code' => static::generateCode()]);
        return $setting;
    }

    private static function generateCode(): string
    {
        return Str::upper(Str::random(8));
    }
}
