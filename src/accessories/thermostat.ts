import { CharacteristicValue, Service } from 'homebridge';
import { SmartRentPlatform } from '../platform.js';
import type { SmartRentAccessory } from './index.js';
import {
  DeviceAttribute,
  ThermostatData,
  ThermostatFanMode,
  ThermostatMode,
} from '../devices/index.js';
import { WSEvent } from '../lib/client.js';
import { findStateByName } from '../lib/utils.js';

export class ThermostatAccessory {
  private readonly thermostatService: Service;
  private readonly fanService: Service;

  private readonly state: {
    hubId: string;
    deviceId: string;
    heating_cooling_state: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    current_temperature: {
      current: CharacteristicValue;
    };
    target_temperature: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    temperature_display_units: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    current_relative_humidity: {
      current: CharacteristicValue;
    };
    cooling_threshold_temperature: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    heating_threshold_temperature: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
    fan_on: {
      current: CharacteristicValue;
      target: CharacteristicValue;
    };
  };

  constructor(
    private readonly platform: SmartRentPlatform,
    private readonly accessory: SmartRentAccessory
  ) {
    this.state = {
      hubId: this.accessory.context.device.room.hub_id.toString(),
      deviceId: this.accessory.context.device.id.toString(),
      heating_cooling_state: {
        current:
          this.platform.api.hap.Characteristic.CurrentHeatingCoolingState.OFF,
        target:
          this.platform.api.hap.Characteristic.TargetHeatingCoolingState.OFF,
      },
      current_temperature: {
        current: -270,
      },
      target_temperature: {
        current: 10,
        target: 10,
      },
      temperature_display_units: {
        current:
          this.platform.api.hap.Characteristic.TemperatureDisplayUnits
            .FAHRENHEIT,
        target:
          this.platform.api.hap.Characteristic.TemperatureDisplayUnits
            .FAHRENHEIT,
      },
      current_relative_humidity: {
        current: 0,
      },
      cooling_threshold_temperature: {
        current: 10,
        target: 10,
      },
      heating_threshold_temperature: {
        current: 0,
        target: 0,
      },
      fan_on: {
        current: 0,
        target: 0,
      },
    };

    // set accessory information
    this.accessory
      .getService(this.platform.api.hap.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.api.hap.Characteristic.SerialNumber,
        this.accessory.context.device.id.toString()
      );

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    this.thermostatService =
      this.accessory.getService(this.platform.api.hap.Service.Thermostat) ||
      this.accessory.addService(this.platform.api.hap.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    this.thermostatService.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    // create handlers for required characteristics
    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.CurrentHeatingCoolingState
      )
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.TargetHeatingCoolingState
      )
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.CurrentTemperature
      )
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.thermostatService
      .getCharacteristic(this.platform.api.hap.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.TemperatureDisplayUnits
      )
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.CurrentRelativeHumidity
      )
      .onGet(this.handleCurrentRelativeHumidityGet.bind(this));

    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.CoolingThresholdTemperature
      )
      .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
      .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));

    this.thermostatService
      .getCharacteristic(
        this.platform.api.hap.Characteristic.HeatingThresholdTemperature
      )
      .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
      .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));

    // get the Fan service if it exists, otherwise create a new Fan service
    this.fanService =
      this.accessory.getService(this.platform.api.hap.Service.Fan) ||
      this.accessory.addService(this.platform.api.hap.Service.Fan);

    // set the service name, this is what is displayed as the default name on the Home app
    this.fanService.setCharacteristic(
      this.platform.api.hap.Characteristic.Name,
      accessory.context.device.name
    );

    // create handlers for required characteristics
    this.fanService
      .getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onGet(this.handleOnGet.bind(this))
      .onSet(this.handleOnSet.bind(this));

    this.platform.smartRentApi.websocket.event[this.state.deviceId] = (
      event: WSEvent
    ) => this.handleDeviceStateChanged(event);
  }

  private handleDeviceStateChanged(event: WSEvent) {
    this.platform.log.debug(
      `Device ${this.state.deviceId} state changed: ${JSON.stringify(event)}`
    );
    switch (event.name) {
      case 'fan_mode':
        this.handleFanModeChange(event);
        break;
      case 'mode':
        this.handleModeChange(event);
        break;
      case 'cooling_setpoint':
        this.handleCoolingSetpointChange(event);
        break;
      case 'heating_setpoint':
        this.handleHeatingSetpointChange(event);
        break;
      case 'current_temp':
        this.handleTempChange(event);
        break;
      case 'current_humidity':
        this.handleHumidtyChange(event);
        break;
    }
  }

  private handleHumidtyChange(event: WSEvent) {
    const humidity = Math.round(Number(event.last_read_state));
    this.state.current_relative_humidity.current = humidity;
    this.thermostatService.updateCharacteristic(
      this.platform.api.hap.Characteristic.CurrentRelativeHumidity,
      humidity
    );
  }

  private handleTempChange(event: WSEvent) {
    const temperature = this.toTemperatureCharacteristic(
      Number(event.last_read_state)
    );
    this.state.current_temperature.current = temperature;
    this.thermostatService.updateCharacteristic(
      this.platform.api.hap.Characteristic.CurrentTemperature,
      temperature
    );
  }

  private handleHeatingSetpointChange(event: WSEvent) {
    const heatingSetpoint = this.toTemperatureCharacteristic(
      Number(event.last_read_state)
    );
    this.state.heating_threshold_temperature.current = heatingSetpoint;
    this.state.heating_threshold_temperature.target = heatingSetpoint;
    this.thermostatService.updateCharacteristic(
      this.platform.api.hap.Characteristic.HeatingThresholdTemperature,
      heatingSetpoint
    );
  }

  private handleCoolingSetpointChange(event: WSEvent) {
    const coolingSetpoint = this.toTemperatureCharacteristic(
      Number(event.last_read_state)
    );
    this.state.cooling_threshold_temperature.current = coolingSetpoint;
    this.state.cooling_threshold_temperature.target = coolingSetpoint;
    this.thermostatService.updateCharacteristic(
      this.platform.api.hap.Characteristic.CoolingThresholdTemperature,
      coolingSetpoint
    );
  }

  private handleModeChange(event: WSEvent) {
    const mode = this.toTargetHeatingCoolingStateCharacteristic(
      event.last_read_state as ThermostatMode
    );
    let actualMode = mode;
    if (
      mode ===
      this.platform.api.hap.Characteristic.TargetHeatingCoolingState.AUTO
    ) {
      // Determine if heating or cooling based on target and current temperature
      if (
        this.state.target_temperature.current <
        this.state.current_temperature.current
      ) {
        actualMode =
          this.platform.api.hap.Characteristic.CurrentHeatingCoolingState.COOL;
      } else if (
        this.state.target_temperature.current >
        this.state.current_temperature.current
      ) {
        actualMode =
          this.platform.api.hap.Characteristic.CurrentHeatingCoolingState.HEAT;
      } else {
        actualMode =
          this.platform.api.hap.Characteristic.CurrentHeatingCoolingState.OFF;
      }
    }
    this.state.heating_cooling_state.current = actualMode;
    this.state.heating_cooling_state.target = mode;
    this.thermostatService.updateCharacteristic(
      this.platform.api.hap.Characteristic.CurrentHeatingCoolingState,
      actualMode
    );
    this.thermostatService.updateCharacteristic(
      this.platform.api.hap.Characteristic.TargetHeatingCoolingState,
      mode
    );
  }

  private handleFanModeChange(event: WSEvent) {
    const fanMode = this.toFanOnCharacteristic(
      event.last_read_state as ThermostatFanMode
    );
    this.state.fan_on.current = fanMode;
    this.fanService.updateCharacteristic(
      this.platform.api.hap.Characteristic.On,
      fanMode
    );
  }

  private toCurrentHeatingCoolingStateCharacteristic(
    thermostatMode: ThermostatMode
  ) {
    switch (thermostatMode) {
      case 'cool':
        return this.platform.api.hap.Characteristic.CurrentHeatingCoolingState
          .COOL;
      case 'heat':
        return this.platform.api.hap.Characteristic.CurrentHeatingCoolingState
          .HEAT;
      case 'off':
      default:
        return this.platform.api.hap.Characteristic.CurrentHeatingCoolingState
          .OFF;
    }
  }

  private toTargetHeatingCoolingStateCharacteristic(
    thermostatMode: ThermostatMode
  ) {
    switch (thermostatMode) {
      case 'cool':
        return this.platform.api.hap.Characteristic.TargetHeatingCoolingState
          .COOL;
      case 'heat':
        return this.platform.api.hap.Characteristic.TargetHeatingCoolingState
          .HEAT;
      case 'auto':
        return this.platform.api.hap.Characteristic.TargetHeatingCoolingState
          .AUTO;
      case 'off':
      default:
        return this.platform.api.hap.Characteristic.TargetHeatingCoolingState
          .OFF;
    }
  }

  private fromTargetHeatingCoolingStateCharacteristic(
    targetHeatingCoolingState
  ): ThermostatMode {
    switch (targetHeatingCoolingState) {
      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.COOL:
        return 'cool';
      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.HEAT:
        return 'heat';
      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.AUTO:
        return 'auto';
      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.OFF:
      default:
        return 'off';
    }
  }

  private toTargetTemperatureCharacteristic(
    thermostatAttributes: DeviceAttribute[]
  ) {
    const mode = findStateByName(
      thermostatAttributes,
      'mode'
    ) as ThermostatMode;
    const cooling_setpoint = findStateByName(
      thermostatAttributes,
      'cooling_setpoint'
    ) as number;
    const heating_setpoint = findStateByName(
      thermostatAttributes,
      'heating_setpoint'
    ) as number;
    switch (mode) {
      case 'off':
      case 'cool':
        return this.toTemperatureCharacteristic(cooling_setpoint);
      case 'heat':
      case 'auto':
      default:
        return this.toTemperatureCharacteristic(heating_setpoint);
    }
  }

  private fromTargetTemperatureCharacteristic(
    temperature: number
  ): DeviceAttribute[] {
    const target_temp = this.fromTemperatureCharacteristic(temperature);
    switch (this.state.heating_cooling_state.current) {
      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.OFF:
      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.COOL:
        return [{ name: 'cooling_setpoint', state: target_temp }];

      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.HEAT:
        return [{ name: 'heating_setpoint', state: target_temp }];

      case this.platform.api.hap.Characteristic.TargetHeatingCoolingState.AUTO:
      default:
        return [];
    }
  }

  // --- Improved temperature conversion with validation ---
  private fromTemperatureCharacteristic(
    temperature: number | null | undefined
  ) {
    if (typeof temperature !== 'number' || isNaN(temperature)) {
      this.platform.log.warn('Invalid temperature for API:', temperature);
      return 70; // fallback to a safe default (Fahrenheit)
    }

    // Round to nearest whole number as SmartRent expects integer values
    const fahrenheit = Math.round((temperature * 9) / 5 + 32);

    this.platform.log.debug(
      `fromTemperatureCharacteristic ${temperature}°C => ${fahrenheit}°F`
    );

    // Ensure the value is within SmartRent's allowed range (typically 50-90°F)
    return Math.max(50, Math.min(90, fahrenheit));
  }

  private toTemperatureCharacteristic(
    temperature: string | number | null | undefined
  ) {
    if (temperature === null || temperature === undefined) {
      this.platform.log.warn('Invalid temperature from API:', temperature);
      return 21; // fallback to safe default (Celsius)
    }

    const temp = Number(temperature);
    if (isNaN(temp)) {
      this.platform.log.warn('Could not parse temperature:', temperature);
      return 21;
    }

    // Convert F to C and round to 1 decimal
    const celsius = Math.round((((temp - 32) * 5) / 9) * 10) / 10;
    this.platform.log.debug(
      `toTemperatureCharacteristic ${temp}°F => ${celsius}°C`
    );

    return Math.max(10, Math.min(38, celsius));
  }

  private toFanOnCharacteristic(thermostatFanMode: ThermostatFanMode) {
    switch (thermostatFanMode) {
      case 'on':
        return true;
      case 'auto':
        return false;
      default:
        return false;
    }
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  async handleCurrentHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET CurrentHeatingCoolingState');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue = this.toCurrentHeatingCoolingStateCharacteristic(
      findStateByName(thermostatAttributes, 'mode') as ThermostatMode
    );
    this.state.heating_cooling_state.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateGet() {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue = this.toTargetHeatingCoolingStateCharacteristic(
      findStateByName(thermostatAttributes, 'mode') as ThermostatMode
    );
    this.state.heating_cooling_state.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value) {
    this.platform.log.debug('Triggered SET TargetHeatingCoolingState:', value);
    this.state.heating_cooling_state.target = value;
    const mode = this.fromTargetHeatingCoolingStateCharacteristic(value);
    const newAttributes = [{ name: 'mode', state: mode }];
    const thermostatAttributes =
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );
    this.state.heating_cooling_state.current =
      this.toTargetHeatingCoolingStateCharacteristic(
        findStateByName(thermostatAttributes, 'mode') as ThermostatMode
      );
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  // --- Use destructuring for GET handlers ---
  // --- Use destructuring for GET handlers ---
  async handleCurrentTemperatureGet() {
    this.platform.log.debug('Triggered GET CurrentTemperature');
    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );
    // Assuming thermostatAttributes is an array of DeviceAttribute
    const current_temp = findStateByName(
      thermostatAttributes,
      'current_temp'
    ) as number;
    const currentValue = this.toTemperatureCharacteristic(current_temp);
    this.state.current_temperature.current = currentValue;
    return currentValue;
  }

  // ...repeat similar improvements for other handlers...

  // --- Improved fan mode conversion ---
  private fromFanOnCharacteristic(on: boolean): ThermostatFanMode {
    return on ? 'on' : 'auto';
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  async handleTargetTemperatureGet() {
    this.platform.log.debug('Triggered GET TargetTemperature');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue =
      this.toTargetTemperatureCharacteristic(thermostatAttributes);
    this.state.target_temperature.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  // --- Use object payloads for API setState ---
  private async handleTargetTemperatureSet(value: CharacteristicValue) {
    const deviceName = this.accessory.context.device.name;

    try {
      const numValue = typeof value === 'number' ? value : Number(value);

      // Convert Celsius to Fahrenheit and round to whole number
      const fahrenheit = Math.round(
        this.fromTemperatureCharacteristic(numValue)
      );

      const mode =
        this.state.heating_cooling_state.current ===
        this.platform.api.hap.Characteristic.TargetHeatingCoolingState.COOL
          ? 'cooling'
          : 'heating';

      this.platform.log.info(
        `Setting "${deviceName}" ${mode} temperature to ${numValue}°C (${fahrenheit}°F)`
      );

      // Validate Fahrenheit temperature is within SmartRent's allowed range
      if (fahrenheit < 50 || fahrenheit > 90) {
        throw new Error(
          `Temperature ${fahrenheit}°F is outside allowed range (50-90°F)`
        );
      }

      // Create attributes array - note the state must be a string!
      const newAttributes = [
        {
          name: mode === 'cooling' ? 'cooling_setpoint' : 'heating_setpoint',
          state: fahrenheit.toString(), // Convert to string
        },
      ];

      await this.platform.smartRentApi.setState(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );

      // Update local state after successful API call
      this.state.target_temperature.target = numValue;
      this.state.target_temperature.current = numValue;

      this.platform.log.info(
        `Successfully set "${deviceName}" ${mode} temperature to ${numValue}°C (${fahrenheit}°F)`
      );
    } catch (error) {
      this.platform.log.error(
        `Failed to set "${deviceName}" temperature:`,
        error
      );
      if (
        error &&
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'data' in error.response
      ) {
        this.platform.log.error(
          'API Error details:',
          JSON.stringify(error.response.data)
        );
      }
      throw error;
    }
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsGet() {
    this.platform.log.debug('Triggered GET TemperatureDisplayUnits');

    // set this to a valid value for TemperatureDisplayUnits
    return this.platform.api.hap.Characteristic.TemperatureDisplayUnits
      .FAHRENHEIT;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsSet(value) {
    this.platform.log.debug('Triggered SET TemperatureDisplayUnits:', value);
  }

  /**
   * Handle requests to get the current value of the "Current Relative Humidity" characteristic
   */
  async handleCurrentRelativeHumidityGet() {
    this.platform.log.debug('Triggered GET CurrentRelativeHumidity');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue = findStateByName(
      thermostatAttributes,
      'current_humidity'
    ) as number;
    this.state.current_relative_humidity.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET CoolingThresholdTemperature');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue = this.toTemperatureCharacteristic(
      findStateByName(thermostatAttributes, 'cooling_setpoint') as number
    );
    this.state.cooling_threshold_temperature.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureSet(value) {
    this.platform.log.debug(
      'Triggered SET CoolingThresholdTemperature:',
      value
    );

    this.state.cooling_threshold_temperature.target = value;
    const cooling_setpoint = this.fromTemperatureCharacteristic(value);
    const newAttributes = [
      { name: 'cooling_setpoint', state: cooling_setpoint },
    ];
    const thermostatAttributes =
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );

    this.state.cooling_threshold_temperature.current =
      this.toTemperatureCharacteristic(
        findStateByName(thermostatAttributes, 'cooling_setpoint') as number
      );
  }

  /**
   * Handle requests to get the current value of the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureGet() {
    this.platform.log.debug('Triggered GET HeatingThresholdTemperature');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue = this.toTemperatureCharacteristic(
      findStateByName(thermostatAttributes, 'heating_setpoint') as number
    );
    this.state.heating_threshold_temperature.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureSet(value) {
    this.platform.log.debug(
      'Triggered SET HeatingThresholdTemperature:',
      value
    );

    this.state.heating_threshold_temperature.target = value;
    const heating_setpoint = this.fromTemperatureCharacteristic(value);
    const newAttributes = [
      { name: 'heating_setpoint', state: heating_setpoint },
    ];
    const thermostatAttributes =
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );

    this.state.heating_threshold_temperature.current =
      this.toTemperatureCharacteristic(
        findStateByName(thermostatAttributes, 'heating_setpoint') as number
      );
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  async handleOnGet() {
    this.platform.log.debug('Triggered GET On');

    const thermostatAttributes = await this.platform.smartRentApi.getState(
      this.state.hubId,
      this.state.deviceId
    );

    const currentValue = this.toFanOnCharacteristic(
      findStateByName(thermostatAttributes, 'fan_mode') as ThermostatFanMode
    );
    this.state.fan_on.current = currentValue;
    return currentValue;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleOnSet(value) {
    this.platform.log.debug('Triggered SET On:', value);

    this.state.fan_on.target = value;
    const fan_mode = value ? 'on' : 'auto';
    const newAttributes = [{ name: 'fan_mode', state: fan_mode }];
    const thermostatAttributes =
      await this.platform.smartRentApi.setState<ThermostatData>(
        this.state.hubId,
        this.state.deviceId,
        newAttributes
      );
    this.state.fan_on.current = this.toFanOnCharacteristic(
      findStateByName(thermostatAttributes, 'fan_mode') as ThermostatFanMode
    );
  }
}
