<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleLocation extends Model
{
    protected $primaryKey = 'location_record_id';

    protected $fillable = [
        'vehicle_id',
        'current_location',
        'address_area',
        'updated_by',
        'remarks',
    ];

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function updatedBy()
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
