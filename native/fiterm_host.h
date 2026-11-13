#pragma once

#include <string>

#ifndef FITERM_HOST_STANDALONE
#include "gea_runtime.h"
#endif

std::string fiterm_host_invoke(const std::string &method, const std::string &payload);

#ifndef FITERM_HOST_STANDALONE
extern gea::CallableObject<std::string(std::string, std::string)> fitermHostInvoke;
#endif
