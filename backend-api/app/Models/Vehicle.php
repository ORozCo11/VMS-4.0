<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Vehicle extends Model
{
    protected $primaryKey = 'vehicle_id';

    protected $fillable = [
        'vehicle_name',
        'plate_number',
        'category_id',
        'brand',
        'model',
        'year_model',
        'capacity',
        'fuel_type',
        'vehicle_color',
        'current_location',
        'photo_url',
        'remarks',
        'status',
        'condition',
    ];

    public function category()
    {
        return $this->belongsTo(VehicleCategory::class, 'category_id', 'category_id');
    }

    public function issueReports()
    {
        return $this->hasMany(VehicleIssueReport::class, 'vehicle_id', 'vehicle_id');
    }

    public function maintenanceRecords()
    {
        return $this->hasMany(VehicleMaintenanceRecord::class, 'vehicle_id', 'vehicle_id');
    }

    public function histories()
    {
        return $this->hasMany(VehicleHistory::class, 'vehicle_id', 'vehicle_id');
    }
}
