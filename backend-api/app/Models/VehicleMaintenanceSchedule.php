<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleMaintenanceSchedule extends Model
{
    protected $primaryKey = 'schedule_id';

    protected $fillable = [
        'vehicle_id',
        'maintenance_type',
        'scheduled_date',
        'scheduled_time',
        'service_location',
        'notes',
        'status',
        'created_by',
        'assigned_to',
    ];

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function assignedTo()
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }
}
