<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleHub extends Model
{
    protected $primaryKey = 'hub_id';

    protected $fillable = [
        'hub_key',
        'name',
        'label',
        'lat',
        'lng',
        'match_names',
        'is_default',
        'is_hidden',
        'created_by',
    ];

    protected $casts = [
        'match_names' => 'array',
        'is_default' => 'boolean',
        'is_hidden' => 'boolean',
        'lat' => 'float',
        'lng' => 'float',
    ];

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
