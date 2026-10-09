// nlink - native WinRT transport for the Ulanzi NEEWER plugin.
//
// Speaks a line protocol on stdin/stdout so that Ulanzi's Node process can drive
// Windows Bluetooth without any .NET runtime or npm native addon.
//
//   scan <ms>              -> device <addr> <name>   (repeated)  then  scan.done <n>
//   open <addr>            -> open.ok <addr> <name> | open.err <hresult>
//   write <addr> <hex>     -> write.ok | write.err <hresult>
//   close <addr>           -> close.ok
//   status <addr>          -> status <connection> <name>
//   quit                   -> exit
//
// Asynchronous traffic from the fixture is interleaved on the same stream:
//   notify <addr> <hex>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Storage.Streams.h>

#include <windows.h>

#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>

using namespace winrt::Windows::Devices::Bluetooth;
using namespace winrt::Windows::Devices::Bluetooth::Advertisement;
using namespace winrt::Windows::Devices::Bluetooth::GenericAttributeProfile;
using namespace winrt::Windows::Storage::Streams;

namespace {

constexpr int TIMEOUT_DEVICE_MS = 10000;
constexpr int TIMEOUT_SERVICE_MS = 15000;
constexpr int TIMEOUT_CHARACTERISTICS_MS = 15000;
constexpr int TIMEOUT_WRITE_MS = 5000;

// ---------------------------------------------------------------------------
// output

void emit(const std::string& line) {
  fputs(line.c_str(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

// ---------------------------------------------------------------------------
// addressing
//
// Windows hands us the 48-bit fixture address directly in the low bits of the
// 64-bit value, most significant byte first. No byte reordering is involved.

std::string formatAddress(uint64_t value) {
  char buffer[32];
  snprintf(buffer, sizeof buffer, "%02X:%02X:%02X:%02X:%02X:%02X",
           static_cast<unsigned>((value >> 40) & 0xff), static_cast<unsigned>((value >> 32) & 0xff),
           static_cast<unsigned>((value >> 24) & 0xff), static_cast<unsigned>((value >> 16) & 0xff),
           static_cast<unsigned>((value >> 8) & 0xff), static_cast<unsigned>(value & 0xff));
  return buffer;
}

bool parseAddress(const std::string& text, uint64_t& out) {
  std::string clean;
  for (char c : text) {
    if (c != ':' && c != '-' && c != ' ') clean.push_back(c);
  }
  if (clean.size() != 12) return false;
  out = 0;
  for (size_t i = 0; i < 12; i += 2) {
    char pair[3] = {clean[i], clean[i + 1], 0};
    char* end = nullptr;
    unsigned long byte = strtoul(pair, &end, 16);
    if (!end || *end) return false;
    out = (out << 8) | byte;
  }
  return true;
}

uint64_t reverseBytes(uint64_t value) {
  uint64_t out = 0;
  for (int i = 0; i < 6; ++i) {
    out = (out << 8) | ((value >> (8 * i)) & 0xff);
  }
  return out;
}

std::vector<uint8_t> parseHex(const std::string& text) {
  std::string clean;
  for (char c : text) {
    if (c != ' ' && c != ',') clean.push_back(c);
  }
  std::vector<uint8_t> out;
  for (size_t i = 0; i + 1 < clean.size(); i += 2) {
    char pair[3] = {clean[i], clean[i + 1], 0};
    out.push_back(static_cast<uint8_t>(strtoul(pair, nullptr, 16)));
  }
  return out;
}

std::string toHex(const std::vector<uint8_t>& bytes) {
  std::string out;
  char slot[4];
  for (uint8_t b : bytes) {
    snprintf(slot, sizeof slot, "%02X", b);
    if (!out.empty()) out.push_back(' ');
    out.append(slot);
  }
  return out;
}

std::string narrow(const winrt::hstring& value) {
  std::wstring wide(value.c_str());
  return std::string(wide.begin(), wide.end());
}

std::string uuidPrefix(winrt::guid value) {
  char buffer[16];
  snprintf(buffer, sizeof buffer, "%08X", value.Data1);
  return buffer;
}

// ---------------------------------------------------------------------------
// message pump: WinRT delivers event callbacks through the owning thread's COM
// queue, so the pump has to keep running or the fixture never notifies.

void pump(int milliseconds) {
  DWORD deadline = GetTickCount() + static_cast<DWORD>(milliseconds);
  for (;;) {
    MSG msg;
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    if (GetTickCount() >= deadline) return;
    Sleep(5);
  }
}

// Blocking wait with a deadline. A hung Windows call must not wedge the whole
// helper: the plugin would then never see an answer for that fixture.
template <typename T>
bool waitFor(winrt::Windows::Foundation::IAsyncOperation<T> const& operation, T& out,
             int timeoutMs) {
  DWORD start = GetTickCount();
  while (operation.Status() == winrt::Windows::Foundation::AsyncStatus::Started) {
    if (static_cast<int>(GetTickCount() - start) > timeoutMs) return false;
    pump(10);
  }
  if (operation.Status() == winrt::Windows::Foundation::AsyncStatus::Error) return false;
  out = operation.GetResults();
  return true;
}

bool waitFor(winrt::Windows::Foundation::IAsyncAction const& action, int timeoutMs) {
  DWORD start = GetTickCount();
  while (action.Status() == winrt::Windows::Foundation::AsyncStatus::Started) {
    if (static_cast<int>(GetTickCount() - start) > timeoutMs) return false;
    pump(10);
  }
  return action.Status() == winrt::Windows::Foundation::AsyncStatus::Completed;
}

// ---------------------------------------------------------------------------
// one connected fixture

struct Link {
  BluetoothLEDevice device{nullptr};
  GattDeviceService service{nullptr};
  GattCharacteristic writeCharacteristic{nullptr};
  GattCharacteristic notifyCharacteristic{nullptr};
  winrt::event_token notifyToken{};
};

std::map<std::string, Link> links;

IBuffer toBuffer(const std::vector<uint8_t>& bytes) {
  DataWriter writer;
  writer.WriteBytes(winrt::array_view<const uint8_t>(bytes.data(), bytes.data() + bytes.size()));
  return writer.DetachBuffer();
}

void closeLink(const std::string& address) {
  auto it = links.find(address);
  if (it == links.end()) return;
  if (it->second.notifyCharacteristic) {
    it->second.notifyCharacteristic.ValueChanged(it->second.notifyToken);
  }
  if (it->second.device) it->second.device.Close();
  links.erase(it);
}

// ---------------------------------------------------------------------------
// commands

void commandScan(int milliseconds) {
  auto watcher = BluetoothLEAdvertisementWatcher();
  std::map<uint64_t, std::string> devices;

  auto token = watcher.Received(
      [&devices](BluetoothLEAdvertisementWatcher const&,
                 BluetoothLEAdvertisementReceivedEventArgs const& args) {
        uint64_t address = args.BluetoothAddress();
        if (devices.find(address) == devices.end()) {
          std::string name = narrow(args.Advertisement().LocalName());
          devices[address] = name;
          emit("device " + formatAddress(address) + " " +
               std::to_string(static_cast<int>(args.RawSignalStrengthInDBm())) + " " +
               (name.empty() ? std::string("-") : name));
        }
      });

  watcher.Start();
  pump(milliseconds);
  watcher.Stop();
  watcher.Received(token);
  emit("scan.done " + std::to_string(devices.size()));
}

void commandOpen(const std::string& address) {
  auto existing = links.find(address);
  if (existing != links.end()) {
    emit("open.ok " + address + " " + narrow(existing->second.device.Name()));
    return;
  }

  uint64_t numeric = 0;
  if (!parseAddress(address, numeric)) {
    emit("open.err 0x80070057");
    return;
  }

  Link link;
  uint64_t resolved = 0;
  if (!waitFor(BluetoothLEDevice::FromBluetoothAddressAsync(numeric), link.device, TIMEOUT_DEVICE_MS) ||
      !link.device) {
    // Some stacks hand out the fixture address in the opposite byte order.
    link.device.Close();
    if (!waitFor(BluetoothLEDevice::FromBluetoothAddressAsync(reverseBytes(numeric)), link.device,
                 TIMEOUT_DEVICE_MS) ||
        !link.device) {
      link.device.Close();
      emit("open.err 0x80070490");
      return;
    }
    resolved = reverseBytes(numeric);
  } else {
    resolved = numeric;
  }
  std::string canonical = formatAddress(resolved);

  try {
    GattDeviceServicesResult services{nullptr};
    if (!waitFor(link.device.GetGattServicesAsync(), services, TIMEOUT_SERVICE_MS)) {
      emit("open.err 0x800705B4");
      link.device.Close();
      return;
    }
    for (auto const& candidate : services.Services()) {
      if (uuidPrefix(candidate.Uuid()) == "69400001") link.service = candidate;
    }
    if (!link.service) {
      emit("open.err 0x80070424");
      link.device.Close();
      return;
    }

    GattCharacteristicsResult characteristics{nullptr};
    if (!waitFor(link.service.GetCharacteristicsAsync(), characteristics, TIMEOUT_CHARACTERISTICS_MS)) {
      emit("open.err 0x800705B4");
      link.device.Close();
      return;
    }
    if (characteristics.Status() != GattCommunicationStatus::Success) {
      emit("open.err 0x80070005");
      link.device.Close();
      return;
    }
    for (auto const& candidate : characteristics.Characteristics()) {
      std::string prefix = uuidPrefix(candidate.Uuid());
      if (prefix == "69400002") link.writeCharacteristic = candidate;
      if (prefix == "69400003") link.notifyCharacteristic = candidate;
    }
    if (!link.writeCharacteristic) {
      emit("open.err 0x80070422");
      link.device.Close();
      return;
    }

    if (link.notifyCharacteristic) {
      std::string notifyAddress = canonical;
      link.notifyToken = link.notifyCharacteristic.ValueChanged(
          [&, notifyAddress](GattCharacteristic const&, GattValueChangedEventArgs const& args) {
            auto buffer = args.CharacteristicValue();
            uint32_t length = buffer.Length();
            std::vector<uint8_t> bytes(length);
            auto reader = DataReader::FromBuffer(buffer);
            reader.ReadBytes(winrt::array_view<uint8_t>(bytes.data(), length));
            emit("notify " + notifyAddress + " " + toHex(bytes));
          });
      GattWriteResult notifyResult{nullptr};
      waitFor(link.notifyCharacteristic.WriteClientCharacteristicConfigurationDescriptorWithResultAsync(
                  GattClientCharacteristicConfigurationDescriptorValue::Notify),
              notifyResult, TIMEOUT_WRITE_MS);
    }

    links[canonical] = link;
    emit("open.ok " + canonical + " " + narrow(link.device.Name()));
  } catch (winrt::hresult_error const& e) {
    if (link.device) link.device.Close();
    emit("open.err " + std::to_string(e.code()));
  }
}

void commandWrite(const std::string& address, const std::string& hex) {
  auto it = links.find(address);
  if (it == links.end()) {
    emit("write.err 0x80070422");
    return;
  }
  try {
    GattWriteResult result{nullptr};
    if (!waitFor(it->second.writeCharacteristic.WriteValueWithResultAsync(
                     toBuffer(parseHex(hex)), GattWriteOption::WriteWithoutResponse),
                 result, TIMEOUT_WRITE_MS)) {
      emit("write.err 0x800705B4");
      return;
    }
    emit(result.Status() == GattCommunicationStatus::Success ? "write.ok" : "write.err 0x80070005");
  } catch (winrt::hresult_error const& e) {
    emit("write.err " + std::to_string(e.code()));
  }
}

void commandStatus(const std::string& address) {
  auto it = links.find(address);
  if (it == links.end()) {
    emit("status 0 -");
    return;
  }
  emit("status " + std::to_string(static_cast<int>(it->second.device.ConnectionStatus())) + " " +
       narrow(it->second.device.Name()));
}

void dispatch(const std::string& line) {
  size_t space = line.find(' ');
  std::string verb = (space == std::string::npos) ? line : line.substr(0, space);
  std::string rest = (space == std::string::npos) ? "" : line.substr(space + 1);

  if (verb == "scan") {
    commandScan(rest.empty() ? 6000 : atoi(rest.c_str()));
  } else if (verb == "open") {
    commandOpen(rest);
  } else if (verb == "write") {
    size_t gap = rest.find(' ');
    if (gap == std::string::npos) {
      emit("write.err 0x80070057");
    } else {
      commandWrite(rest.substr(0, gap), rest.substr(gap + 1));
    }
  } else if (verb == "close") {
    closeLink(rest);
    emit("close.ok");
  } else if (verb == "status") {
    commandStatus(rest);
  } else if (verb == "quit" || verb == "exit") {
    for (auto& entry : links) {
      if (entry.second.device) entry.second.device.Close();
    }
    links.clear();
    exit(0);
  } else if (!verb.empty()) {
    emit("err 0x80070057 unknown=" + verb);
  }
}

bool readLine(std::string& out) {
  out.clear();
  for (;;) {
    DWORD available = 0;
    if (!PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), nullptr, 0, nullptr, &available, nullptr)) {
      return false;
    }
    if (available > 0) break;
    MSG msg;
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    Sleep(5);
  }
  char buffer[4096];
  DWORD read = 0;
  if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer, sizeof buffer, &read, nullptr) || read == 0) {
    return false;
  }
  out.assign(buffer, read);
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
  return true;
}

}  // namespace

int main() {
  winrt::init_apartment(winrt::apartment_type::single_threaded);
  emit("ready");

  std::string line;
  while (readLine(line)) {
    if (!line.empty()) dispatch(line);
  }
  return 0;
}