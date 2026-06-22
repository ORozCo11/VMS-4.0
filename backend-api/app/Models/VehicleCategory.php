<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class VehicleCategory extends Model
{
    protected $primaryKey = 'category_id';

    protected $fillable = [
        'category_name',
        'description',
    ];

    public function vehicles()
    {
        return $this->hasMany(Vehicle::class, 'category_id', 'category_id');
    }
}
