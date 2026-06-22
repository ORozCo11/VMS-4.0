<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleHistory extends Model
{
    protected $primaryKey = 'history_id';

    protected $fillable = [
        'vehicle_id',
        'activity_type',
        'description',
        'related_table',
        'related_record_id',
        'updated_by',
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
