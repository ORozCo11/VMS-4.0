<?php

namespace App\Models;

use App\Models\Concerns\ScopedThroughVehicle;
use Illuminate\Database\Eloquent\Model;

class VehicleLocation extends Model
{
    use ScopedThroughVehicle;

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
