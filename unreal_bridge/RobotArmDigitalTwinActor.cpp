#include "RobotArmDigitalTwinActor.h"

#include "WebSocketsModule.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Modules/ModuleManager.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "TextureResource.h"

ARobotArmDigitalTwinActor::ARobotArmDigitalTwinActor()
{
	PrimaryActorTick.bCanEverTick = true;
	TargetJointsDeg.Init(0.0f, 6);
	CurrentJointsDeg.Init(0.0f, 6);
}

void ARobotArmDigitalTwinActor::BeginPlay()
{
	Super::BeginPlay();
	ConnectWebSocket();
}

void ARobotArmDigitalTwinActor::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (Socket.IsValid() && Socket->IsConnected())
	{
		Socket->Close();
	}
	Socket.Reset();
	Super::EndPlay(EndPlayReason);
}

void ARobotArmDigitalTwinActor::ConnectWebSocket()
{
	if (!FModuleManager::Get().IsModuleLoaded(TEXT("WebSockets")))
	{
		FModuleManager::Get().LoadModuleChecked(TEXT("WebSockets"));
	}

	Socket = FWebSocketsModule::Get().CreateWebSocket(WebSocketURL, TEXT(""));

	Socket->OnConnected().AddLambda([this]()
	{
		bIsConnected = true;
		UE_LOG(LogTemp, Log, TEXT("[DigitalTwin] Connected to Python Core Hub: %s"), *WebSocketURL);
	});

	Socket->OnConnectionError().AddLambda([this](const FString& Error)
	{
		bIsConnected = false;
		UE_LOG(LogTemp, Warning, TEXT("[DigitalTwin] WebSocket error: %s"), *Error);
	});

	Socket->OnClosed().AddLambda([this](int32 StatusCode, const FString& Reason, bool bWasClean)
	{
		bIsConnected = false;
	});

	Socket->OnMessage().AddLambda([this](const FString& Message)
	{
		HandleTelemetryJson(Message);
	});

	Socket->Connect();
}

void ARobotArmDigitalTwinActor::HandleTelemetryJson(const FString& Message)
{
	TSharedPtr<FJsonObject> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		return;
	}

	if (const TSharedPtr<FJsonObject>* SysObj; Root->TryGetObjectField(TEXT("system"), SysObj))
	{
		(*SysObj)->TryGetStringField(TEXT("mission_phase"), MissionPhase);
	}

	// 1. Robot 6-DOF Joints & Electrical Telemetry
	if (const TSharedPtr<FJsonObject>* RobotObj; Root->TryGetObjectField(TEXT("robot"), RobotObj))
	{
		if (const TSharedPtr<FJsonObject>* JObj; (*RobotObj)->TryGetObjectField(TEXT("joints_deg"), JObj))
		{
			TargetJointsDeg[0] = static_cast<float>((*JObj)->GetNumberField(TEXT("j1_base")));
			TargetJointsDeg[1] = static_cast<float>((*JObj)->GetNumberField(TEXT("j2_shoulder")));
			TargetJointsDeg[2] = static_cast<float>((*JObj)->GetNumberField(TEXT("j3_elbow")));
			TargetJointsDeg[3] = static_cast<float>((*JObj)->GetNumberField(TEXT("j4_wrist_pitch")));
			TargetJointsDeg[4] = static_cast<float>((*JObj)->GetNumberField(TEXT("j5_wrist_roll")));
			TargetJointsDeg[5] = static_cast<float>((*JObj)->GetNumberField(TEXT("j6_gripper")));
		}

		if (const TSharedPtr<FJsonObject>* ElecObj; (*RobotObj)->TryGetObjectField(TEXT("electrical"), ElecObj))
		{
			BusVoltageV = static_cast<float>((*ElecObj)->GetNumberField(TEXT("bus_voltage_v")));
			TotalCurrentA = static_cast<float>((*ElecObj)->GetNumberField(TEXT("total_current_a")));
		}
	}

	// 2. OpenCV Active Cube Properties
	if (const TSharedPtr<FJsonObject>* VisionObj; Root->TryGetObjectField(TEXT("vision"), VisionObj))
	{
		const TSharedPtr<FJsonObject>* CubeObj = nullptr;
		if ((*VisionObj)->TryGetObjectField(TEXT("active_cube"), CubeObj) && CubeObj && CubeObj->IsValid())
		{
			(*CubeObj)->TryGetStringField(TEXT("id"), ActiveCube.CubeId);
			(*CubeObj)->TryGetStringField(TEXT("color_tr"), ActiveCube.ColorNameTR);
			(*CubeObj)->TryGetStringField(TEXT("material"), ActiveCube.MaterialName);
			(*CubeObj)->TryGetStringField(TEXT("target_zone"), ActiveCube.TargetZone);
			ActiveCube.EstWeightGrams = static_cast<float>((*CubeObj)->GetNumberField(TEXT("est_weight_g")));
			ActiveCube.ConfidencePct = static_cast<float>((*CubeObj)->GetNumberField(TEXT("confidence_pct")));
			ActiveCube.YawDeg = static_cast<float>((*CubeObj)->GetNumberField(TEXT("yaw_deg")));

			const TArray<TSharedPtr<FJsonValue>>* DimsArr = nullptr;
			if ((*CubeObj)->TryGetArrayField(TEXT("size_mm"), DimsArr) && DimsArr->Num() >= 3)
			{
				ActiveCube.DimensionsMm = FVector(
					(*DimsArr)[0]->AsNumber(),
					(*DimsArr)[1]->AsNumber(),
					(*DimsArr)[2]->AsNumber()
				);
			}
		}
	}

	// 3. Wi-Fi CSI Room & Human Operator Tracking
	if (const TSharedPtr<FJsonObject>* CSIObj; Root->TryGetObjectField(TEXT("wifi_csi"), CSIObj))
	{
		if (const TSharedPtr<FJsonObject>* OpObj; (*CSIObj)->TryGetObjectField(TEXT("operator"), OpObj))
		{
			if (const TSharedPtr<FJsonObject>* PosObj; (*OpObj)->TryGetObjectField(TEXT("ue5_pos_cm"), PosObj))
			{
				WiFiCSI.OperatorLocationCm = FVector(
					(*PosObj)->GetNumberField(TEXT("x")),
					(*PosObj)->GetNumberField(TEXT("y")),
					(*PosObj)->GetNumberField(TEXT("z"))
				);
			}
			WiFiCSI.OperatorYawDeg = FMath::RadiansToDegrees(static_cast<float>((*OpObj)->GetNumberField(TEXT("yaw_rad"))));
			(*OpObj)->TryGetStringField(TEXT("posture"), WiFiCSI.Posture);
			WiFiCSI.PresenceConfidence = static_cast<float>((*OpObj)->GetNumberField(TEXT("presence_confidence")));
			WiFiCSI.BreathingBPM = static_cast<float>((*OpObj)->GetNumberField(TEXT("breathing_bpm")));
			WiFiCSI.MotionEnergy = static_cast<float>((*OpObj)->GetNumberField(TEXT("motion_energy")));
		}

		const TArray<TSharedPtr<FJsonValue>>* SubArr = nullptr;
		if ((*CSIObj)->TryGetArrayField(TEXT("subcarriers_amp"), SubArr))
		{
			WiFiCSI.SubcarrierAmplitudes.Reset(SubArr->Num());
			for (const auto& Val : *SubArr)
			{
				WiFiCSI.SubcarrierAmplitudes.Add(static_cast<float>(Val->AsNumber()));
			}
		}
	}

	OnTelemetryUpdated(ActiveCube, WiFiCSI);
}

void ARobotArmDigitalTwinActor::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	// Smoothly interpolate all 6 servo joints to remove any network jitter at 120+ FPS
	for (int32 i = 0; i < 6; ++i)
	{
		CurrentJointsDeg[i] = FMath::FInterpTo(CurrentJointsDeg[i], TargetJointsDeg[i], DeltaTime, 18.0f);
	}

	// Apply transforms in UE5 Z-Up centimeters (Base Yaw = Z, Pitch = Y, Roll = Z)
	if (J1_BasePivot)       J1_BasePivot->SetRelativeRotation(FRotator(0.0f, CurrentJointsDeg[0], 0.0f));
	if (J2_ShoulderPivot)   J2_ShoulderPivot->SetRelativeRotation(FRotator(-CurrentJointsDeg[1], 0.0f, 0.0f));
	if (J3_ElbowPivot)      J3_ElbowPivot->SetRelativeRotation(FRotator(-CurrentJointsDeg[2], 0.0f, 0.0f));
	if (J4_WristPitchPivot) J4_WristPitchPivot->SetRelativeRotation(FRotator(-CurrentJointsDeg[3], 0.0f, 0.0f));
	if (J5_WristRollPivot)  J5_WristRollPivot->SetRelativeRotation(FRotator(0.0f, CurrentJointsDeg[4], 0.0f));

	const float JawHalfCm = 2.2f + (CurrentJointsDeg[5] / 90.0f) * 1.8f;
	if (J6_LeftJaw)  J6_LeftJaw->SetRelativeLocation(FVector(0.0f, -JawHalfCm, 0.0f));
	if (J6_RightJaw) J6_RightJaw->SetRelativeLocation(FVector(0.0f,  JawHalfCm, 0.0f));

	// Move Wi-Fi CSI Tracked Human Operator Actor inside the UE5 Lab Room
	if (OperatorActor)
	{
		const FVector TargetLoc = GetActorLocation() + WiFiCSI.OperatorLocationCm - FVector(0.0f, 0.0f, 78.0f);
		const FVector Smoothed = FMath::VInterpTo(OperatorActor->GetActorLocation(), TargetLoc, DeltaTime, 8.0f);
		OperatorActor->SetActorLocation(Smoothed);
		OperatorActor->SetActorRotation(FRotator(0.0f, WiFiCSI.OperatorYawDeg, 0.0f));
	}

	// Poll live OpenCV ESP32-CAM annotated JPEG onto a UE5 UTexture2D
	CameraPollAccum += DeltaTime;
	if (CameraPollAccum >= CameraPollIntervalSec && !bCameraReqInFlight)
	{
		CameraPollAccum = 0.0f;
		PollCameraFrame();
	}
}

void ARobotArmDigitalTwinActor::PollCameraFrame()
{
	bCameraReqInFlight = true;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(CameraFrameURL);
	Req->SetVerb(TEXT("GET"));
	Req->OnProcessRequestComplete().BindLambda(
		[this](FHttpRequestPtr /*Request*/, FHttpResponsePtr Response, bool bSucceeded)
		{
			bCameraReqInFlight = false;
			if (!bSucceeded || !Response.IsValid() || Response->GetResponseCode() != 200)
			{
				return;
			}

			const TArray<uint8>& JpegBytes = Response->GetContent();
			IImageWrapperModule& ImgModule = FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
			TSharedPtr<IImageWrapper> Wrapper = ImgModule.CreateImageWrapper(EImageFormat::JPEG);
			if (!Wrapper.IsValid() || !Wrapper->SetCompressed(JpegBytes.GetData(), JpegBytes.Num()))
			{
				return;
			}

			TArray<uint8> RawBGRA;
			if (!Wrapper->GetRaw(ERGBFormat::BGRA, 8, RawBGRA))
			{
				return;
			}

			const int32 W = Wrapper->GetWidth();
			const int32 H = Wrapper->GetHeight();
			if (!LiveCameraTexture || LiveCameraTexture->GetSizeX() != W || LiveCameraTexture->GetSizeY() != H)
			{
				LiveCameraTexture = UTexture2D::CreateTransient(W, H, PF_B8G8R8A8);
				LiveCameraTexture->UpdateResource();
			}

			FTexture2DMipMap& Mip = LiveCameraTexture->GetPlatformData()->Mips[0];
			void* Data = Mip.BulkData.Lock(LOCK_READ_WRITE);
			FMemory::Memcpy(Data, RawBGRA.GetData(), RawBGRA.Num());
			Mip.BulkData.Unlock();
			LiveCameraTexture->UpdateResource();

			OnCameraTextureUpdated(LiveCameraTexture);
		}
	);
	Req->ProcessRequest();
}

void ARobotArmDigitalTwinActor::SendJsonCommand(const FString& JsonPayload)
{
	if (Socket.IsValid() && Socket->IsConnected())
	{
		Socket->Send(JsonPayload);
	}
}
