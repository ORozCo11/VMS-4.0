<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleConditionCheck extends Model
{
    protected $primaryKey = 'condition_check_id';

    protected $fillable = [
        'vehicle_id',
        'condition_result',
        'observations',
        'checked_by',
        'remarks',
    ];

    public function vehicle()
    {
        return $this->belongsTo(Vehicle::class, 'vehicle_id', 'vehicle_id');
    }

    public function checkedBy()
    {
        return $this->belongsTo(User::class, 'checked_by');
    }
}
