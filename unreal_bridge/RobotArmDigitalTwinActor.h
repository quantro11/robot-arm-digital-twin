#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "IWebSocket.h"
#include "Engine/Texture2D.h"
#include "RobotArmDigitalTwinActor.generated.h"

USTRUCT(BlueprintType)
struct FCubeVisionTelemetry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	FString CubeId;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	FString ColorNameTR;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	FString MaterialName;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	FString TargetZone;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	FVector DimensionsMm = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	float EstWeightGrams = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	float ConfidencePct = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	FVector WorldLocationCm = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	float YawDeg = 0.0f;
};

USTRUCT(BlueprintType)
struct FWiFiCSIOperatorTelemetry
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	FVector OperatorLocationCm = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	float OperatorYawDeg = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	FString Posture = TEXT("OBSERVING");

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	float PresenceConfidence = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	float BreathingBPM = 15.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	float MotionEnergy = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|WiFiCSI")
	TArray<float> SubcarrierAmplitudes;
};

/**
 * Unreal Engine 5 Real-Time Digital Twin Bridge Actor
 * Connects to Python Core Hub (ws://127.0.0.1:8765/ws/twin?client=ue5)
 * Drives 6-DOF robot joints, updates OpenCV Cube Inspector HUD & Live Camera Texture,
 * and positions the Wi-Fi CSI tracked Operator & RF Niagara Wave Field.
 */
UCLASS(Blueprintable)
class ARobotArmDigitalTwinActor : public AActor
{
	GENERATED_BODY()

public:
	ARobotArmDigitalTwinActor();

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void Tick(float DeltaTime) override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Connection")
	FString WebSocketURL = TEXT("ws://127.0.0.1:8765/ws/twin?client=ue5");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Connection")
	FString CameraFrameURL = TEXT("http://127.0.0.1:8765/api/camera/frame.jpg");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Connection")
	float CameraPollIntervalSec = 0.08f;

	// Assign your 3D-printed arm joint SceneComponents (or drive a Control Rig from TargetJointsDeg)
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J1_BasePivot;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J2_ShoulderPivot;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J3_ElbowPivot;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J4_WristPitchPivot;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J5_WristRollPivot;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J6_LeftJaw;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|Joints")
	TObjectPtr<USceneComponent> J6_RightJaw;

	// Optional Actor representing the Wi-Fi CSI tracked Operator (e.g. Holographic Mannequin / MetaHuman)
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "DigitalTwin|WiFiCSI")
	TObjectPtr<AActor> OperatorActor;

	// Live Telemetry Exposed to Blueprints & UMG Widgets
	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	bool bIsConnected = false;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	FString MissionPhase = TEXT("SCANNING");

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	TArray<float> TargetJointsDeg;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	FCubeVisionTelemetry ActiveCube;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	FWiFiCSIOperatorTelemetry WiFiCSI;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	float BusVoltageV = 6.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Telemetry")
	float TotalCurrentA = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "DigitalTwin|Vision")
	TObjectPtr<UTexture2D> LiveCameraTexture;

	// Blueprint events fired automatically on new telemetry & camera frames
	UFUNCTION(BlueprintImplementableEvent, Category = "DigitalTwin|Events")
	void OnTelemetryUpdated(const FCubeVisionTelemetry& CubeInfo, const FWiFiCSIOperatorTelemetry& CSIInfo);

	UFUNCTION(BlueprintImplementableEvent, Category = "DigitalTwin|Events")
	void OnCameraTextureUpdated(UTexture2D* NewTexture);

	// Send commands back from UE5 UI to Python/ESP32 (e.g., reset_cubes, toggle_pause)
	UFUNCTION(BlueprintCallable, Category = "DigitalTwin|Control")
	void SendJsonCommand(const FString& JsonPayload);

private:
	TSharedPtr<IWebSocket> Socket;
	TArray<float> CurrentJointsDeg;
	float CameraPollAccum = 0.0f;
	bool bCameraReqInFlight = false;

	void ConnectWebSocket();
	void HandleTelemetryJson(const FString& Message);
	void PollCameraFrame();
};
