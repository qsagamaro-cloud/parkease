#include <winsock2.h>
#include <windows.h>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <cstdlib>
#include <cstring>

#pragma comment(lib, "ws2_32.lib")

// ---- Settings ----
const char *COM_PORT = "\\\\.\\COM4";                         // Arduino COM port
const char *SERVER_IP = "127.0.0.1";                          // Computer running node server.js
const int SERVER_PORT = 3000;
const char *API_KEY = "parkease_hardware_secret_123";         // Must exist in the api_keys table
const int SLOT_NUMBER = 1;                                    // The one bay that has a sensor
const float OCCUPIED_DISTANCE_CM = 45.72f;                    // 1.5 feet. Closer than this = Occupied
const int NO_ECHO_DISTANCE_CM = 400;                          // Sent to the server when nothing is detected
const unsigned long SEND_EVERY_MS = 300;                      // How often to update the server

// Latest reading shared between the serial thread and the sender thread
std::atomic<float> latestDistance(-1.0f);
std::atomic<bool> haveReading(false);

// Sends one reading to the web server. Returns the HTTP status code, or -1 if the server can't be reached.
int postToServer(int distanceCm)
{
    SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET)
        return -1;

    DWORD timeoutMs = 2000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeoutMs, sizeof(timeoutMs));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeoutMs, sizeof(timeoutMs));

    sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(SERVER_PORT);
    addr.sin_addr.s_addr = inet_addr(SERVER_IP);
    memset(addr.sin_zero, 0, sizeof(addr.sin_zero));

    if (connect(s, (sockaddr *)&addr, sizeof(addr)) == SOCKET_ERROR)
    {
        closesocket(s);
        return -1;
    }

    std::string body = "{\"slot\":" + std::to_string(SLOT_NUMBER) +
                       ",\"distance_cm\":" + std::to_string(distanceCm) + "}";

    std::string request =
        "POST /api/update HTTP/1.1\r\n"
        "Host: " + std::string(SERVER_IP) + ":" + std::to_string(SERVER_PORT) + "\r\n"
        "Content-Type: application/json\r\n"
        "x-api-key: " + std::string(API_KEY) + "\r\n"
        "Content-Length: " + std::to_string(body.length()) + "\r\n"
        "Connection: close\r\n\r\n" +
        body;

    send(s, request.c_str(), (int)request.length(), 0);

    char resp[256];
    int n = recv(s, resp, sizeof(resp) - 1, 0);
    closesocket(s);

    if (n >= 12)
    {
        resp[n] = '\0';
        return atoi(resp + 9); // "HTTP/1.1 200 OK" -> 200
    }
    return -1;
}

// Runs in its own thread so a slow or offline server never delays the sensor readings
void sendToServerLoop()
{
    int lastServerCode = 0; // 0 = nothing sent yet

    while (true)
    {
        if (haveReading)
        {
            float distance = latestDistance;
            int sendValue = (distance < 0) ? NO_ECHO_DISTANCE_CM : (int)(distance + 0.5f);
            int code = postToServer(sendValue);

            // Only report when the connection to the server changes
            if (code != lastServerCode)
            {
                if (code == 200)
                    std::cout << "[server] Connected - updating Bay " << SLOT_NUMBER << std::endl;
                else if (code == -1)
                    std::cout << "[server] Not reachable. Is node server.js running?" << std::endl;
                else
                    std::cout << "[server] Error, HTTP status " << code << std::endl;
                lastServerCode = code;
            }

            // If the server is offline, wait a bit longer before trying again
            Sleep(code == 200 ? SEND_EVERY_MS : 2000);
        }
        else
        {
            Sleep(100);
        }
    }
}

// Reads the Arduino and prints the distance
void listenToArduino()
{
    HANDLE hSerial = CreateFileA(COM_PORT, GENERIC_READ, 0, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);

    if (hSerial == INVALID_HANDLE_VALUE)
    {
        std::cerr << "Error opening " << COM_PORT << " (Windows error " << GetLastError() << ")." << std::endl;
        std::cerr << "Check: Arduino is plugged in, the port number is right, and the Arduino IDE" << std::endl;
        std::cerr << "Serial Monitor is closed (and no other hardware.exe is running)." << std::endl;
        return;
    }

    DCB dcbParams = {0};
    dcbParams.DCBlength = sizeof(dcbParams);
    GetCommState(hSerial, &dcbParams);
    dcbParams.BaudRate = CBR_9600;
    dcbParams.ByteSize = 8;
    dcbParams.StopBits = ONESTOPBIT;
    dcbParams.Parity = NOPARITY;
    SetCommState(hSerial, &dcbParams);

    COMMTIMEOUTS timeouts = {0};
    timeouts.ReadIntervalTimeout = 50;
    timeouts.ReadTotalTimeoutConstant = 50;
    timeouts.ReadTotalTimeoutMultiplier = 10;
    SetCommTimeouts(hSerial, &timeouts);

    std::cout << "Connected to Arduino! Reading ultrasonic sensor..." << std::endl;

    char buffer[128];
    DWORD bytesRead;
    std::string serialData = "";
    int badLines = 0;

    while (true)
    {
        if (ReadFile(hSerial, buffer, sizeof(buffer) - 1, &bytesRead, NULL) && bytesRead > 0)
        {
            buffer[bytesRead] = '\0';
            serialData += buffer;

            size_t pos = serialData.find("\r\n");
            while (pos != std::string::npos)
            {
                std::string message = serialData.substr(0, pos);
                serialData.erase(0, pos + 2);

                // Expected format: "DIST:23.4"
                if (message.rfind("DIST:", 0) == 0)
                {
                    badLines = 0;
                    float distance = (float)atof(message.substr(5).c_str());
                    bool occupied = (distance >= 0 && distance < OCCUPIED_DISTANCE_CM);

                    latestDistance = distance;
                    haveReading = true;

                    if (distance < 0)
                        std::cout << "Distance: out of range -> Available" << std::endl;
                    else
                        std::cout << "Distance: " << distance << " cm -> "
                                  << (occupied ? "Occupied" : "Available") << std::endl;
                }
                else if (!message.empty())
                {
                    // A stray line right at startup is normal. Repeated ones mean the wrong sketch is uploaded.
                    badLines++;
                    if (badLines >= 3)
                        std::cout << "Unexpected data from Arduino: " << message
                                  << "  (upload ultrasonic.ino to the Arduino)" << std::endl;
                }
                pos = serialData.find("\r\n");
            }
        }
        Sleep(10);
    }
    CloseHandle(hSerial);
}

int main()
{
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    std::cout << "PARKEASE hardware bridge. Sending Bay " << SLOT_NUMBER
              << " readings to http://" << SERVER_IP << ":" << SERVER_PORT << std::endl;

    std::thread serialThread(listenToArduino);
    std::thread senderThread(sendToServerLoop);
    senderThread.detach();
    serialThread.join();

    std::cout << std::endl << "Stopped. Press Enter to close this window..." << std::endl;
    std::cin.get();

    WSACleanup();
    return 0;
}
